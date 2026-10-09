
import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import { db } from "../../db/pool.js";
import { withTransaction } from "../../db/transaction.js";

export type BlockchainOutboxEventType =
  | "REGISTER_JOB"
  | "UPDATE_STATUS"
  | "RECORD_ROUND";

export type BlockchainOutboxStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface BlockchainOutboxRecord {
  outboxId: string;
  jobId: string;
  eventType: BlockchainOutboxEventType;
  payload: Record<string, unknown>;
  status: BlockchainOutboxStatus;
  idempotencyKey: string;
  attempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBlockchainOutboxInput {
  jobId: string;
  eventType: BlockchainOutboxEventType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

interface BlockchainOutboxRow extends QueryResultRow {
  outbox_id: string;
  job_id: string;
  event_type: BlockchainOutboxEventType;
  payload: Record<string, unknown>;
  status: BlockchainOutboxStatus;
  idempotency_key: string;
  attempts: number;
  available_at: Date;
  locked_at: Date | null;
  completed_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapOutboxRow(
  row: BlockchainOutboxRow,
): BlockchainOutboxRecord {
  return {
    outboxId: row.outbox_id,
    jobId: row.job_id,
    eventType: row.event_type,
    payload: row.payload,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    availableAt: row.available_at,
    lockedAt: row.locked_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Create a blockchain outbox event idempotently.
 *
 * Repeated requests using the same idempotency key and
 * identical operation return the existing event.
 *
 * Reusing a key for a different job, event type, or payload
 * throws an error.
 *
 * If a PoolClient is supplied, all queries participate in
 * the caller's existing PostgreSQL transaction.
 *
 * Otherwise, the operation runs in its own transaction.
 */
export async function createBlockchainOutboxEvent(
  input: CreateBlockchainOutboxInput,
  client?: PoolClient,
): Promise<BlockchainOutboxRecord> {
  const outboxId = randomUUID();

  const execute = async (
    executor: PoolClient | typeof db,
  ): Promise<BlockchainOutboxRecord> => {
    const payload = JSON.stringify(input.payload);

    const result = await executor.query<BlockchainOutboxRow>(
      `
        INSERT INTO blockchain_outbox (
          outbox_id,
          job_id,
          event_type,
          payload,
          status,
          idempotency_key,
          attempts,
          available_at,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4::jsonb,
          'pending',
          $5,
          0,
          NOW(),
          NOW(),
          NOW()
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING
          outbox_id,
          job_id,
          event_type,
          payload,
          status,
          idempotency_key,
          attempts,
          available_at,
          locked_at,
          completed_at,
          last_error,
          created_at,
          updated_at
      `,
      [
        outboxId,
        input.jobId,
        input.eventType,
        payload,
        input.idempotencyKey,
      ],
    );

    const insertedRow = result.rows[0];

    if (insertedRow) {
      return mapOutboxRow(insertedRow);
    }

    // The key already exists. Check whether it represents
    // the same logical operation using PostgreSQL JSONB equality.
    const existingResult =
      await executor.query<BlockchainOutboxRow>(
        `
          SELECT
            outbox_id,
            job_id,
            event_type,
            payload,
            status,
            idempotency_key,
            attempts,
            available_at,
            locked_at,
            completed_at,
            last_error,
            created_at,
            updated_at
          FROM blockchain_outbox
          WHERE idempotency_key = $1
          LIMIT 1
        `,
        [input.idempotencyKey],
      );

    const existingRow = existingResult.rows[0];

    if (!existingRow) {
      throw new Error(
        `Unable to resolve blockchain outbox idempotency key "${input.idempotencyKey}"`,
      );
    }

    const identityResult = await executor.query<{
      matches: boolean;
    } & QueryResultRow>(
      `
        SELECT (
          job_id = $2
          AND event_type = $3
          AND payload = $4::jsonb
        ) AS matches
        FROM blockchain_outbox
        WHERE idempotency_key = $1
      `,
      [
        input.idempotencyKey,
        input.jobId,
        input.eventType,
        payload,
      ],
    );

    const sameOperation =
      identityResult.rows[0]?.matches === true;

    if (!sameOperation) {
      throw new Error(
        `Idempotency key "${input.idempotencyKey}" is already used by a different blockchain outbox event`,
      );
    }

    return mapOutboxRow(existingRow);
  };

  if (client) {
    return execute(client);
  }

  return withTransaction(async (transactionClient) => {
    return execute(transactionClient);
  });
}

/**
 * Find an outbox event by idempotency key.
 */
export async function findBlockchainOutboxByIdempotencyKey(
  idempotencyKey: string,
): Promise<BlockchainOutboxRecord | null> {
  const result = await db.query<BlockchainOutboxRow>(
    `
      SELECT
        outbox_id,
        job_id,
        event_type,
        payload,
        status,
        idempotency_key,
        attempts,
        available_at,
        locked_at,
        completed_at,
        last_error,
        created_at,
        updated_at
      FROM blockchain_outbox
      WHERE idempotency_key = $1
      LIMIT 1
    `,
    [idempotencyKey],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return mapOutboxRow(row);
}

/**
 * Atomically claim pending blockchain outbox events.
 *
 * FOR UPDATE SKIP LOCKED allows multiple coordinator
 * instances to process different events concurrently.
 */
export async function claimPendingBlockchainOutboxEvents(
  limit = 10,
): Promise<BlockchainOutboxRecord[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      "Outbox claim limit must be a positive integer",
    );
  }

  return withTransaction(async (client) => {
    const result = await client.query<BlockchainOutboxRow>(
      `
        WITH claimed AS (
          SELECT outbox_id
          FROM blockchain_outbox
          WHERE status = 'pending'
            AND available_at <= NOW()
          ORDER BY created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE blockchain_outbox AS o
        SET
          status = 'processing',
          locked_at = NOW(),
          attempts = o.attempts + 1,
          updated_at = NOW()
        FROM claimed
        WHERE o.outbox_id = claimed.outbox_id
        RETURNING
          o.outbox_id,
          o.job_id,
          o.event_type,
          o.payload,
          o.status,
          o.idempotency_key,
          o.attempts,
          o.available_at,
          o.locked_at,
          o.completed_at,
          o.last_error,
          o.created_at,
          o.updated_at
      `,
      [limit],
    );

    return result.rows.map(mapOutboxRow);
  });
}

/**
 * Mark an outbox event as completed.
 */
export async function markBlockchainOutboxCompleted(
  outboxId: string,
): Promise<BlockchainOutboxRecord | null> {
  const result = await db.query<BlockchainOutboxRow>(
    `
      UPDATE blockchain_outbox
      SET
        status = 'completed',
        locked_at = NULL,
        completed_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
      WHERE outbox_id = $1
      RETURNING
        outbox_id,
        job_id,
        event_type,
        payload,
        status,
        idempotency_key,
        attempts,
        available_at,
        locked_at,
        completed_at,
        last_error,
        created_at,
        updated_at
    `,
    [outboxId],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return mapOutboxRow(row);
}

/**
 * Mark an outbox event as failed and schedule a retry.
 *
 * The event remains retryable by returning it to the
 * pending state.
 */
export async function markBlockchainOutboxFailed(
  outboxId: string,
  errorMessage: string,
  retryDelaySeconds = 30,
): Promise<BlockchainOutboxRecord | null> {
  if (
    !Number.isFinite(retryDelaySeconds) ||
    retryDelaySeconds < 0
  ) {
    throw new Error(
      "Retry delay must be a non-negative number",
    );
  }

  const result = await db.query<BlockchainOutboxRow>(
    `
      UPDATE blockchain_outbox
      SET
        status = 'pending',
        locked_at = NULL,
        available_at =
          NOW() + ($2 * INTERVAL '1 second'),
        last_error = $3,
        updated_at = NOW()
      WHERE outbox_id = $1
      RETURNING
        outbox_id,
        job_id,
        event_type,
        payload,
        status,
        idempotency_key,
        attempts,
        available_at,
        locked_at,
        completed_at,
        last_error,
        created_at,
        updated_at
    `,
    [
      outboxId,
      retryDelaySeconds,
      errorMessage,
    ],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return mapOutboxRow(row);
}

/**
 * Release stale processing events back to pending.
 *
 * This recovers events when a coordinator or blockchain
 * worker crashes after claiming an event but before
 * completing or failing it.
 */
export async function releaseStaleBlockchainOutboxEvents(
  staleAfterSeconds = 300,
): Promise<number> {
  if (
    !Number.isFinite(staleAfterSeconds) ||
    staleAfterSeconds <= 0
  ) {
    throw new Error(
      "Stale threshold must be a positive number",
    );
  }

  const result = await db.query(
    `
      UPDATE blockchain_outbox
      SET
        status = 'pending',
        locked_at = NULL,
        available_at = NOW(),
        last_error = COALESCE(
          last_error,
          'Recovered stale blockchain outbox event'
        ),
        updated_at = NOW()
      WHERE status = 'processing'
        AND locked_at IS NOT NULL
        AND locked_at <
          NOW() - ($1 * INTERVAL '1 second')
    `,
    [staleAfterSeconds],
  );

  return result.rowCount ?? 0;
}
