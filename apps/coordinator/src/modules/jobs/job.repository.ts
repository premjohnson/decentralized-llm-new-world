import type { PoolClient } from "pg";

import { db } from "../../db/pool.js";

export type JobType =
  | "training"
  | "inference"
  | "evaluation";

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobRecord {
  jobId: string;
  name: string;
  jobType: JobType;
  status: JobStatus;
  modelName: string;
  datasetName: string | null;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface JobRow {
  job_id: string;
  name: string;
  job_type: JobType;
  status: JobStatus;
  model_name: string;
  dataset_name: string | null;
  config: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface CreateJobInput {
  jobId: string;
  name: string;
  jobType: JobType;
  modelName: string;
  datasetName?: string;
  config?: Record<string, unknown>;
}

function mapJobRow(row: JobRow): JobRecord {
  return {
    jobId: row.job_id,
    name: row.name,
    jobType: row.job_type,
    status: row.status,
    modelName: row.model_name,
    datasetName: row.dataset_name,
    config: row.config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export async function createJob(
  input: CreateJobInput,
  client?: PoolClient,
): Promise<JobRecord> {
  const executor = client ?? db;

  const result = await executor.query<JobRow>(
    `
      INSERT INTO jobs (
        job_id,
        name,
        job_type,
        model_name,
        dataset_name,
        config
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        job_id,
        name,
        job_type,
        status,
        model_name,
        dataset_name,
        config,
        created_at,
        updated_at,
        started_at,
        completed_at
    `,
    [
      input.jobId,
      input.name,
      input.jobType,
      input.modelName,
      input.datasetName ?? null,
      input.config ?? {},
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Failed to create job");
  }

  return mapJobRow(row);
}

export async function findJobById(
  jobId: string,
): Promise<JobRecord | null> {
  const result = await db.query<JobRow>(
    `
      SELECT
        job_id,
        name,
        job_type,
        status,
        model_name,
        dataset_name,
        config,
        created_at,
        updated_at,
        started_at,
        completed_at
      FROM jobs
      WHERE job_id = $1
    `,
    [jobId],
  );

  const row = result.rows[0];

  return row ? mapJobRow(row) : null;
}

export async function findAllJobs(): Promise<JobRecord[]> {
  const result = await db.query<JobRow>(
    `
      SELECT
        job_id,
        name,
        job_type,
        status,
        model_name,
        dataset_name,
        config,
        created_at,
        updated_at,
        started_at,
        completed_at
      FROM jobs
      ORDER BY created_at DESC
    `,
  );

  return result.rows.map(mapJobRow);
}

/**
 * Reconcile a job after one of its tasks changes state.
 *
 * Training lifecycle:
 *
 *   training tasks
 *        ↓
 *   aggregation task
 *        ↓
 *   job completed
 *
 * Therefore a training job MUST NOT become completed merely
 * because all training tasks completed.
 *
 * Rules:
 *
 * - Any permanently failed task => job failed.
 * - Training job:
 *     - all training tasks completed is NOT sufficient.
 *     - aggregation task must also be completed.
 * - Inference/evaluation:
 *     - all tasks completed => job completed.
 *
 * The caller must provide the transaction client so task completion
 * and job reconciliation happen atomically.
 */
export async function reconcileJobStatus(
  jobId: string,
  client: PoolClient,
): Promise<JobRecord | null> {
  /**
   * Read the job type first.
   *
   * FOR UPDATE ensures that reconciliation observes a stable
   * job state inside the caller's transaction.
   */
  const jobResult = await client.query<JobRow>(
    `
      SELECT
        job_id,
        name,
        job_type,
        status,
        model_name,
        dataset_name,
        config,
        created_at,
        updated_at,
        started_at,
        completed_at
      FROM jobs
      WHERE job_id = $1
      FOR UPDATE
    `,
    [jobId],
  );

  const job = jobResult.rows[0];

  if (!job) {
    throw new Error(
      `Job ${jobId} not found during reconciliation`,
    );
  }

  /**
   * Do not modify terminal jobs.
   */
  if (
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "cancelled"
  ) {
    return null;
  }

  /**
   * Read task state.
   *
   * We deliberately calculate training and aggregation
   * independently because training jobs have a multi-stage
   * lifecycle.
   */
  const taskResult = await client.query<{
    total_tasks: string;
    completed_tasks: string;
    failed_tasks: string;

    training_tasks: string;
    completed_training_tasks: string;

    aggregation_tasks: string;
    completed_aggregation_tasks: string;
  }>(
    `
      SELECT
        COUNT(*)::text AS total_tasks,

        COUNT(*) FILTER (
          WHERE status = 'completed'
        )::text AS completed_tasks,

        COUNT(*) FILTER (
          WHERE status = 'failed'
        )::text AS failed_tasks,

        COUNT(*) FILTER (
          WHERE task_type = 'training'
        )::text AS training_tasks,

        COUNT(*) FILTER (
          WHERE
            task_type = 'training'
            AND status = 'completed'
        )::text AS completed_training_tasks,

        COUNT(*) FILTER (
          WHERE task_type = 'aggregation'
        )::text AS aggregation_tasks,

        COUNT(*) FILTER (
          WHERE
            task_type = 'aggregation'
            AND status = 'completed'
        )::text AS completed_aggregation_tasks

      FROM tasks
      WHERE job_id = $1
    `,
    [jobId],
  );

  const counts = taskResult.rows[0];

  if (!counts) {
    throw new Error(
      `Failed to read task status for job ${jobId}`,
    );
  }

  const totalTasks = Number(
    counts.total_tasks,
  );

  const completedTasks = Number(
    counts.completed_tasks,
  );

  const failedTasks = Number(
    counts.failed_tasks,
  );

  const trainingTasks = Number(
    counts.training_tasks,
  );

  const completedTrainingTasks =
    Number(
      counts.completed_training_tasks,
    );

  const aggregationTasks = Number(
    counts.aggregation_tasks,
  );

  const completedAggregationTasks =
    Number(
      counts.completed_aggregation_tasks,
    );

  let nextStatus: JobStatus | null = null;

  /**
   * Failure always wins.
   */
  if (failedTasks > 0) {
    nextStatus = "failed";
  }

  /**
   * Training jobs require BOTH:
   *
   * 1. every training task completed
   * 2. the aggregation task completed
   *
   * This prevents the job from becoming completed before
   * FedAvg/global-model generation finishes.
   */
  else if (job.job_type === "training") {
    const trainingPhaseCompleted =
      trainingTasks > 0 &&
      completedTrainingTasks === trainingTasks;

    const aggregationCompleted =
      aggregationTasks > 0 &&
      completedAggregationTasks ===
        aggregationTasks;

    if (
      trainingPhaseCompleted &&
      aggregationCompleted
    ) {
      nextStatus = "completed";
    }
  }

  /**
   * Inference and evaluation jobs retain the original
   * all-tasks-completed lifecycle.
   */
  else if (
    totalTasks > 0 &&
    completedTasks === totalTasks
  ) {
    nextStatus = "completed";
  }

  /**
   * Nothing terminal happened yet.
   */
  if (!nextStatus) {
    return null;
  }

  const result = await client.query<JobRow>(
    `
      UPDATE jobs
      SET
        status = $2::varchar,

        completed_at = CASE
          WHEN $2::varchar IN (
            'completed',
            'failed'
          )
          THEN COALESCE(
            completed_at,
            NOW()
          )
          ELSE completed_at
        END,

        updated_at = NOW()

      WHERE
        job_id = $1
        AND status NOT IN (
          'completed',
          'failed',
          'cancelled'
        )

      RETURNING
        job_id,
        name,
        job_type,
        status,
        model_name,
        dataset_name,
        config,
        created_at,
        updated_at,
        started_at,
        completed_at
    `,
    [
      jobId,
      nextStatus,
    ],
  );

  const row = result.rows[0];

  return row
    ? mapJobRow(row)
    : null;
}