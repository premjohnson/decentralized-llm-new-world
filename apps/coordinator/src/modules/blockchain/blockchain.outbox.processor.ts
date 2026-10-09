import {
  claimPendingBlockchainOutboxEvents,
  markBlockchainOutboxCompleted,
  markBlockchainOutboxFailed,
  releaseStaleBlockchainOutboxEvents,
  type BlockchainOutboxRecord,
} from "./blockchain.outbox.repository.js";

import { BlockchainService } from "./blockchain.service.js";

import type {
  BlockchainTrainingStatus,
} from "./blockchain.types.js";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_RETRY_DELAY_SECONDS = 30;
const DEFAULT_STALE_AFTER_SECONDS = 300;

const BLOCKCHAIN_STATUSES: readonly BlockchainTrainingStatus[] = [
  "registered",
  "running",
  "completed",
  "failed",
];

export interface BlockchainOutboxProcessorOptions {
  batchSize?: number;
  retryDelaySeconds?: number;
  staleAfterSeconds?: number;
}

export class BlockchainOutboxProcessor {
  private readonly batchSize: number;
  private readonly retryDelaySeconds: number;
  private readonly staleAfterSeconds: number;

  constructor(
    private readonly blockchainService: BlockchainService,
    options: BlockchainOutboxProcessorOptions = {},
  ) {
    this.batchSize =
      options.batchSize ??
      DEFAULT_BATCH_SIZE;

    this.retryDelaySeconds =
      options.retryDelaySeconds ??
      DEFAULT_RETRY_DELAY_SECONDS;

    this.staleAfterSeconds =
      options.staleAfterSeconds ??
      DEFAULT_STALE_AFTER_SECONDS;

    if (
      !Number.isInteger(this.batchSize) ||
      this.batchSize <= 0
    ) {
      throw new Error(
        "Outbox processor batch size must be a positive integer",
      );
    }

    if (
      !Number.isFinite(
        this.retryDelaySeconds,
      ) ||
      this.retryDelaySeconds < 0
    ) {
      throw new Error(
        "Outbox processor retry delay must be non-negative",
      );
    }

    if (
      !Number.isFinite(
        this.staleAfterSeconds,
      ) ||
      this.staleAfterSeconds <= 0
    ) {
      throw new Error(
        "Outbox processor stale threshold must be positive",
      );
    }
  }

  /**
   * Process one batch of pending blockchain events.
   *
   * Returns the number of successfully completed events.
   */
  async processBatch(): Promise<number> {
    /*
     * Recover events that were left in PROCESSING
     * because a coordinator instance crashed or stopped.
     */
    await releaseStaleBlockchainOutboxEvents(
      this.staleAfterSeconds,
    );

    /*
     * Claim events atomically.
     *
     * The repository uses:
     *
     *   FOR UPDATE SKIP LOCKED
     *
     * so multiple processor instances can safely
     * process the same outbox table concurrently.
     */
    const events =
      await claimPendingBlockchainOutboxEvents(
        this.batchSize,
      );

    if (events.length === 0) {
      return 0;
    }

    let completed = 0;

    for (const event of events) {
      const success =
        await this.processEvent(event);

      if (success) {
        completed += 1;
      }
    }

    return completed;
  }

  /**
   * Process one claimed event.
   */
  private async processEvent(
    event: BlockchainOutboxRecord,
  ): Promise<boolean> {
    try {
      await this.dispatchEvent(event);

      const completed =
        await markBlockchainOutboxCompleted(
          event.outboxId,
        );

      if (!completed) {
        throw new Error(
          `Blockchain outbox event '${event.outboxId}' disappeared before completion.`,
        );
      }

      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      await markBlockchainOutboxFailed(
        event.outboxId,
        message,
        this.retryDelaySeconds,
      );

      return false;
    }
  }

  /**
   * Dispatch an outbox event to the appropriate
   * blockchain operation.
   */
  private async dispatchEvent(
    event: BlockchainOutboxRecord,
  ): Promise<void> {
    switch (event.eventType) {
      case "REGISTER_JOB":
        await this.processRegisterJob(event);
        return;

      case "UPDATE_STATUS":
        await this.processUpdateStatus(event);
        return;

      case "RECORD_ROUND":
        await this.processRecordRound(event);
        return;

      default:
        throw new Error(
          `Unsupported blockchain outbox event type: ${event.eventType}`,
        );
    }
  }

  /**
   * Process REGISTER_JOB.
   *
   * Idempotency:
   *
   * If the Solana transaction succeeded but the coordinator
   * crashed before marking the outbox event completed,
   * the TrainingJob PDA will already exist.
   *
   * In that case we simply treat the event as completed.
   */
  private async processRegisterJob(
    event: BlockchainOutboxRecord,
  ): Promise<void> {
    const jobId =
      this.requireString(
        event.payload,
        "jobId",
      );

    const modelName =
      this.requireString(
        event.payload,
        "modelName",
      );

    const modelVersion =
      this.requireString(
        event.payload,
        "modelVersion",
      );

    const workerCount =
      this.requirePositiveInteger(
        event.payload,
        "workerCount",
      );

    const datasetHash =
      this.hexToBytes(
        this.requireString(
          event.payload,
          "datasetHash",
        ),
      );

    /*
     * Check the deterministic TrainingJob PDA before
     * attempting a registration transaction.
     */
    const existing =
      await this.blockchainService.getTrainingJob(
        jobId,
      );

    if (existing) {
      return;
    }

    await this.blockchainService.registerTrainingJob({
      jobId,
      modelName,
      modelVersion,
      workerCount,
      datasetHash,
    });
  }

  /**
   * Process UPDATE_STATUS.
   */
  private async processUpdateStatus(
    event: BlockchainOutboxRecord,
  ): Promise<void> {
    const jobId =
      this.requireString(
        event.payload,
        "jobId",
      );

    const requestedStatus =
      this.requireBlockchainStatus(
        event.payload,
        "status",
      );

    const existing =
      await this.blockchainService.getTrainingJob(
        jobId,
      );

    if (!existing) {
      throw new Error(
        `Training job '${jobId}' does not exist on-chain.`,
      );
    }

    /*
     * Anchor returns the enum as an object such as:
     *
     *   { registered: {} }
     *   { running: {} }
     *   { completed: {} }
     *   { failed: {} }
     *
     * Normalize it to our application-level string.
     */
    const currentStatus =
      normalizeBlockchainStatus(
        existing.status,
      );

    /*
     * If the requested state is already on-chain,
     * the operation is idempotently complete.
     */
    if (
      currentStatus ===
      requestedStatus
    ) {
      return;
    }

    await this.blockchainService.updateTrainingStatus(
      jobId,
      requestedStatus,
    );
  }

  /**
   * Process RECORD_ROUND.
   */
  private async processRecordRound(
    event: BlockchainOutboxRecord,
  ): Promise<void> {
    const jobId =
      this.requireString(
        event.payload,
        "jobId",
      );

    const roundNumber =
      this.requirePositiveInteger(
        event.payload,
        "roundNumber",
      );

    const checkpointHash =
      this.hexToBytes(
        this.requireString(
          event.payload,
          "checkpointHash",
        ),
      );

    const artifactHash =
      this.hexToBytes(
        this.requireString(
          event.payload,
          "artifactHash",
        ),
      );

    const aggregationHash =
      this.hexToBytes(
        this.requireString(
          event.payload,
          "aggregationHash",
        ),
      );

    const existing =
      await this.blockchainService.getTrainingJob(
        jobId,
      );

    if (!existing) {
      throw new Error(
        `Training job '${jobId}' does not exist on-chain.`,
      );
    }

    /*
     * Anchor exposes u64 values as BN.
     *
     * Convert the value at the application boundary
     * instead of importing Anchor's BN type here.
     */
    const currentRound =
      toSafeInteger(
        existing.roundCount,
        "roundCount",
      );

    /*
     * If this round has already been recorded,
     * the previous transaction succeeded.
     *
     * This makes retry processing idempotent.
     */
    if (
      currentRound >=
      roundNumber
    ) {
      return;
    }

    /*
     * Training rounds must be sequential.
     *
     * Example:
     *
     * current = 2
     * requested = 3  -> valid
     *
     * current = 2
     * requested = 4  -> retry later
     */
    const expectedRound =
      currentRound + 1;

    if (
      expectedRound !==
      roundNumber
    ) {
      throw new Error(
        `Training job '${jobId}' is at round ${currentRound}, expected next round ${expectedRound}, received ${roundNumber}.`,
      );
    }

    await this.blockchainService.recordTrainingRound({
      jobId,
      roundNumber,
      checkpointHash,
      artifactHash,
      aggregationHash,
    });
  }

  /**
   * Validate and extract a required string field.
   */
  private requireString(
    payload: Record<string, unknown>,
    field: string,
  ): string {
    const value =
      payload[field];

    if (
      typeof value !== "string" ||
      value.trim().length === 0
    ) {
      throw new Error(
        `Blockchain outbox payload field '${field}' must be a non-empty string.`,
      );
    }

    return value;
  }

  /**
   * Validate and extract a positive integer.
   */
  private requirePositiveInteger(
    payload: Record<string, unknown>,
    field: string,
  ): number {
    const value =
      payload[field];

    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      throw new Error(
        `Blockchain outbox payload field '${field}' must be a positive safe integer.`,
      );
    }

    return value;
  }

  /**
   * Validate and extract a blockchain status.
   */
  private requireBlockchainStatus(
    payload: Record<string, unknown>,
    field: string,
  ): BlockchainTrainingStatus {
    const value =
      payload[field];

    if (
      typeof value !== "string" ||
      !BLOCKCHAIN_STATUSES.includes(
        value as BlockchainTrainingStatus,
      )
    ) {
      throw new Error(
        `Blockchain outbox payload field '${field}' must be one of: ${BLOCKCHAIN_STATUSES.join(", ")}.`,
      );
    }

    return value as BlockchainTrainingStatus;
  }

  /**
   * Convert a hexadecimal SHA-256 hash into 32 bytes.
   *
   * SHA-256:
   *
   * 32 bytes
   * =
   * 64 hexadecimal characters
   */
  private hexToBytes(
    value: string,
  ): Uint8Array {
    const normalized =
      value.trim().toLowerCase();

    if (
      normalized.length !== 64
    ) {
      throw new Error(
        "Blockchain hash must contain exactly 32 bytes (64 hexadecimal characters).",
      );
    }

    if (
      !/^[0-9a-f]+$/.test(
        normalized,
      )
    ) {
      throw new Error(
        "Blockchain hash must contain only hexadecimal characters.",
      );
    }

    const bytes =
      new Uint8Array(32);

    for (
      let index = 0;
      index < 32;
      index += 1
    ) {
      bytes[index] =
        Number.parseInt(
          normalized.slice(
            index * 2,
            index * 2 + 2,
          ),
          16,
        );
    }

    return bytes;
  }
}

/**
 * Convert Anchor's enum representation into the
 * application-level BlockchainTrainingStatus.
 *
 * Anchor may return:
 *
 *   { registered: {} }
 *   { running: {} }
 *   { completed: {} }
 *   { failed: {} }
 *
 * Some mocks/tests may already provide:
 *
 *   "registered"
 *
 * Both representations are supported.
 */
function normalizeBlockchainStatus(
  value: unknown,
): BlockchainTrainingStatus {
  if (
    typeof value === "string" &&
    BLOCKCHAIN_STATUSES.includes(
      value as BlockchainTrainingStatus,
    )
  ) {
    return value as BlockchainTrainingStatus;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    const keys =
      Object.keys(
        value as Record<
          string,
          unknown
        >,
      );

    if (
      keys.length === 1 &&
      BLOCKCHAIN_STATUSES.includes(
        keys[0] as BlockchainTrainingStatus,
      )
    ) {
      return keys[0] as BlockchainTrainingStatus;
    }
  }

  throw new Error(
    `Unsupported blockchain training status returned by Solana: ${JSON.stringify(value)}`,
  );
}

/**
 * Convert an Anchor BN / bigint / number-like value
 * into a safe JavaScript integer.
 *
 * We intentionally do not import BN here.
 *
 * This keeps the processor independent from Anchor's
 * runtime representation.
 */
function toSafeInteger(
  value: unknown,
  field: string,
): number {
  if (
    typeof value === "number"
  ) {
    if (
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error(
        `${field} must be a non-negative safe integer.`,
      );
    }

    return value;
  }

  if (
    typeof value === "bigint"
  ) {
    if (
      value < 0n ||
      value >
        BigInt(
          Number.MAX_SAFE_INTEGER,
        )
    ) {
      throw new Error(
        `${field} exceeds JavaScript safe integer range.`,
      );
    }

    return Number(value);
  }

  if (
    value &&
    typeof value === "object"
  ) {
    const candidate =
      value as {
        toString?: () => string;
      };

    if (
      typeof candidate.toString ===
      "function"
    ) {
      const text =
        candidate.toString();

      if (
        /^\d+$/.test(text)
      ) {
        const parsed =
          Number(text);

        if (
          Number.isSafeInteger(
            parsed,
          )
        ) {
          return parsed;
        }
      }
    }
  }

  throw new Error(
    `${field} must be a non-negative safe integer.`,
  );
}