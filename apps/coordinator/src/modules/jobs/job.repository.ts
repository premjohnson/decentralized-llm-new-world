import type { PoolClient } from "pg";

import { db } from "../../db/pool.js";

export type JobType = "training" | "inference" | "evaluation";

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