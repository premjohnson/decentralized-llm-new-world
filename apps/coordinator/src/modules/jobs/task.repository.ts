import type { PoolClient } from "pg";

import { db } from "../../db/pool.js";

export type TaskType =
  | "training"
  | "inference"
  | "evaluation"
  | "aggregation";

export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "completed"
  | "failed"
  | "retrying"
  | "cancelled";

export interface TaskRecord {
  taskId: string;
  jobId: string;
  workerId: string | null;
  taskType: TaskType;
  status: TaskStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  attempt: number;
  maxAttempts: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  assignedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
}

interface TaskRow {
  task_id: string;
  job_id: string;
  worker_id: string | null;
  task_type: TaskType;
  status: TaskStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  attempt: number;
  max_attempts: number;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  assigned_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
}

export interface CreateTaskInput {
  taskId: string;
  jobId: string;
  taskType: TaskType;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    taskId: row.task_id,
    jobId: row.job_id,
    workerId: row.worker_id,
    taskType: row.task_type,
    status: row.status,
    payload: row.payload,
    result: row.result,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedAt: row.assigned_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
  };
}

/**
 * Create a task.
 *
 * If a PoolClient is provided, the task is created
 * inside the caller's PostgreSQL transaction.
 *
 * Otherwise, the normal database pool is used.
 */
export async function createTask(
  input: CreateTaskInput,
  client?: PoolClient,
): Promise<TaskRecord> {
  const executor = client ?? db;

  const result = await executor.query<TaskRow>(
    `
      INSERT INTO tasks (
        task_id,
        job_id,
        task_type,
        payload,
        max_attempts
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        task_id,
        job_id,
        worker_id,
        task_type,
        status,
        payload,
        result,
        attempt,
        max_attempts,
        error_message,
        created_at,
        updated_at,
        assigned_at,
        started_at,
        completed_at,
        failed_at
    `,
    [
      input.taskId,
      input.jobId,
      input.taskType,
      input.payload ?? {},
      input.maxAttempts ?? 3,
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Failed to create task");
  }

  return mapTaskRow(row);
}

export async function findTaskById(
  taskId: string,
): Promise<TaskRecord | null> {
  const result = await db.query<TaskRow>(
    `
      SELECT
        task_id,
        job_id,
        worker_id,
        task_type,
        status,
        payload,
        result,
        attempt,
        max_attempts,
        error_message,
        created_at,
        updated_at,
        assigned_at,
        started_at,
        completed_at,
        failed_at
      FROM tasks
      WHERE task_id = $1
    `,
    [taskId],
  );

  const row = result.rows[0];

  return row ? mapTaskRow(row) : null;
}

export async function findTasksByJobId(
  jobId: string,
): Promise<TaskRecord[]> {
  const result = await db.query<TaskRow>(
    `
      SELECT
        task_id,
        job_id,
        worker_id,
        task_type,
        status,
        payload,
        result,
        attempt,
        max_attempts,
        error_message,
        created_at,
        updated_at,
        assigned_at,
        started_at,
        completed_at,
        failed_at
      FROM tasks
      WHERE job_id = $1
      ORDER BY created_at ASC
    `,
    [jobId],
  );

  return result.rows.map(mapTaskRow);
}

/**
 * Atomically claim the oldest pending task.
 *
 * FOR UPDATE SKIP LOCKED allows multiple workers
 * to safely claim different tasks concurrently.
 */
export async function claimNextPendingTask(
  workerId: string,
): Promise<TaskRecord | null> {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<TaskRow>(
      `
        SELECT
          task_id,
          job_id,
          worker_id,
          task_type,
          status,
          payload,
          result,
          attempt,
          max_attempts,
          error_message,
          created_at,
          updated_at,
          assigned_at,
          started_at,
          completed_at,
          failed_at
        FROM tasks
        WHERE status = 'pending'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `,
    );

    const row = result.rows[0];

    if (!row) {
      await client.query("COMMIT");
      return null;
    }

    const updated = await client.query<TaskRow>(
      `
        UPDATE tasks
        SET
          worker_id = $1,
          status = 'assigned',
          attempt = attempt + 1,
          assigned_at = NOW(),
          updated_at = NOW()
        WHERE task_id = $2
        RETURNING
          task_id,
          job_id,
          worker_id,
          task_type,
          status,
          payload,
          result,
          attempt,
          max_attempts,
          error_message,
          created_at,
          updated_at,
          assigned_at,
          started_at,
          completed_at,
          failed_at
      `,
      [workerId, row.task_id],
    );

    await client.query("COMMIT");

    const updatedRow = updated.rows[0];

    if (!updatedRow) {
      throw new Error("Failed to claim task");
    }

    return mapTaskRow(updatedRow);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markTaskRunning(
  taskId: string,
  workerId: string,
): Promise<TaskRecord | null> {
  const result = await db.query<TaskRow>(
    `
      UPDATE tasks
      SET
        status = 'running',
        started_at = COALESCE(started_at, NOW()),
        updated_at = NOW()
      WHERE
        task_id = $1
        AND worker_id = $2
        AND status = 'assigned'
      RETURNING
        task_id,
        job_id,
        worker_id,
        task_type,
        status,
        payload,
        result,
        attempt,
        max_attempts,
        error_message,
        created_at,
        updated_at,
        assigned_at,
        started_at,
        completed_at,
        failed_at
    `,
    [taskId, workerId],
  );

  const row = result.rows[0];

  return row ? mapTaskRow(row) : null;
}

/**
 * Mark a running task as completed and persist its result.
 *
 * Only the worker that owns the running task can complete it.
 */
export async function markTaskCompleted(
  taskId: string,
  workerId: string,
  resultPayload: Record<string, unknown>,
): Promise<TaskRecord | null> {
  const result = await db.query<TaskRow>(
    `
      UPDATE tasks
      SET
        status = 'completed',
        result = $3,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE
        task_id = $1
        AND worker_id = $2
        AND status = 'running'
      RETURNING
        task_id,
        job_id,
        worker_id,
        task_type,
        status,
        payload,
        result,
        attempt,
        max_attempts,
        error_message,
        created_at,
        updated_at,
        assigned_at,
        started_at,
        completed_at,
        failed_at
    `,
    [taskId, workerId, resultPayload],
  );

  const row = result.rows[0];

  return row ? mapTaskRow(row) : null;
}

export async function markTaskFailed(
  taskId: string,
  workerId: string,
  errorMessage: string,
): Promise<TaskRecord | null> {
  const result = await db.query<TaskRow>(
    `
      UPDATE tasks
      SET
        status = CASE
          WHEN attempt < max_attempts THEN 'retrying'
          ELSE 'failed'
        END,
        error_message = $3,
        failed_at = NOW(),
        updated_at = NOW()
      WHERE
        task_id = $1
        AND worker_id = $2
        AND status = 'running'
      RETURNING
        task_id,
        job_id,
        worker_id,
        task_type,
        status,
        payload,
        result,
        attempt,
        max_attempts,
        error_message,
        created_at,
        updated_at,
        assigned_at,
        started_at,
        completed_at,
        failed_at
    `,
    [taskId, workerId, errorMessage],
  );

  const row = result.rows[0];

  return row ? mapTaskRow(row) : null;
}

export async function requeueTask(
  taskId: string,
): Promise<TaskRecord | null> {
  const result = await db.query<TaskRow>(
    `
      UPDATE tasks
      SET
        worker_id = NULL,
        status = 'pending',
        updated_at = NOW()
      WHERE
        task_id = $1
        AND status = 'retrying'
      RETURNING
        task_id,
        job_id,
        worker_id,
        task_type,
        status,
        payload,
        result,
        attempt,
        max_attempts,
        error_message,
        created_at,
        updated_at,
        assigned_at,
        started_at,
        completed_at,
        failed_at
    `,
    [taskId],
  );

  const row = result.rows[0];

  return row ? mapTaskRow(row) : null;
}