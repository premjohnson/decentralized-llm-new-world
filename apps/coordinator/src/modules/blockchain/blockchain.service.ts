import {
  BlockchainClient,
} from "./blockchain.client.js";

import type {
  BlockchainTrainingStatus,
  RecordTrainingRoundInput,
  RegisterTrainingJobInput,
} from "./blockchain.types.js";

export interface RegisterJobResult {
  signature: string;
  trainingJobAddress: string;
}

export interface TrainingStatusResult {
  signature: string;
  trainingJobAddress: string;
}

export interface TrainingRoundResult {
  signature: string;
  trainingJobAddress: string;
  trainingRoundAddress: string;
}

/**
 * Coordinator-facing blockchain service.
 *
 * Responsibilities:
 *
 * - Translate Coordinator lifecycle operations into
 *   blockchain operations.
 * - Keep blockchain-specific mechanics inside BlockchainClient.
 * - Provide a stable application-level API for future
 *   Job/Scheduler integration.
 *
 * This service deliberately does NOT contain PostgreSQL
 * transaction logic. Database state and blockchain state
 * are separate consistency domains.
 */
export class BlockchainService {
  constructor(
    private readonly client: BlockchainClient,
  ) {}

  /**
   * Register a Coordinator training job on-chain.
   */
  async registerTrainingJob(
    input: RegisterTrainingJobInput,
  ): Promise<RegisterJobResult> {
    this.validateJobInput(input);

    return this.client.registerTrainingJob(
      input,
    );
  }

  /**
   * Move a blockchain training job to a new lifecycle status.
   */
  async updateTrainingStatus(
    jobId: string,
    status: BlockchainTrainingStatus,
  ): Promise<TrainingStatusResult> {
    if (!jobId.trim()) {
      throw new Error(
        "jobId must not be empty",
      );
    }

    return this.client.updateTrainingStatus({
      jobId,
      status,
    });
  }

  /**
   * Record a completed training round on-chain.
   */
  async recordTrainingRound(
    input: RecordTrainingRoundInput,
  ): Promise<TrainingRoundResult> {
    this.validateRoundInput(input);

    return this.client.recordTrainingRound(
      input,
    );
  }

  /**
   * Read the blockchain representation of a training job.
   */
  async getTrainingJob(
    jobId: string,
  ) {
    if (!jobId.trim()) {
      throw new Error(
        "jobId must not be empty",
      );
    }

    return this.client.getTrainingJob(
      jobId,
    );
  }

  /**
   * Check whether the blockchain training job exists.
   */
  async trainingJobExists(
    jobId: string,
  ): Promise<boolean> {
    const trainingJob =
      await this.getTrainingJob(jobId);

    return trainingJob !== null;
  }

  /**
   * Return the current blockchain authority balance.
   */
  async getAuthorityBalance(): Promise<number> {
    return this.client.getBalance();
  }

  /**
   * Validate registration input at the service boundary.
   */
  private validateJobInput(
    input: RegisterTrainingJobInput,
  ): void {
    if (!input.jobId.trim()) {
      throw new Error(
        "jobId must not be empty",
      );
    }

    if (!input.modelName.trim()) {
      throw new Error(
        "modelName must not be empty",
      );
    }

    if (!input.modelVersion.trim()) {
      throw new Error(
        "modelVersion must not be empty",
      );
    }

    if (
      !Number.isSafeInteger(
        input.workerCount,
      ) ||
      input.workerCount <= 0 ||
      input.workerCount > 65_535
    ) {
      throw new Error(
        "workerCount must be an integer between 1 and 65535",
      );
    }

    if (input.datasetHash.length !== 32) {
      throw new Error(
        "datasetHash must contain exactly 32 bytes",
      );
    }
  }

  /**
   * Validate training-round input at the service boundary.
   */
  private validateRoundInput(
    input: RecordTrainingRoundInput,
  ): void {
    if (!input.jobId.trim()) {
      throw new Error(
        "jobId must not be empty",
      );
    }

    if (
      !Number.isSafeInteger(
        input.roundNumber,
      ) ||
      input.roundNumber <= 0
    ) {
      throw new Error(
        "roundNumber must be a positive safe integer",
      );
    }

    if (
      input.checkpointHash.length !== 32
    ) {
      throw new Error(
        "checkpointHash must contain exactly 32 bytes",
      );
    }

    if (
      input.artifactHash.length !== 32
    ) {
      throw new Error(
        "artifactHash must contain exactly 32 bytes",
      );
    }

    if (
      input.aggregationHash.length !== 32
    ) {
      throw new Error(
        "aggregationHash must contain exactly 32 bytes",
      );
    }
  }
}