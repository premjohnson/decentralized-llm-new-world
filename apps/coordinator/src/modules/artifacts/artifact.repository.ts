import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";

import { db } from "../../db/pool.js";

import type {
  CreateArtifactInput,
} from "./artifact.schema.js";

type QueryExecutor =
  | typeof db
  | PoolClient;

export interface ArtifactRecord {
  artifactId: string;
  taskId: string;
  jobId: string;
  workerId: string | null;
  artifactType: string;
  storageUri: string;
  sha256: string;
  sizeBytes: number;
  sampleCount: number;
  modelName: string;
  format: string;
  createdAt: string;
}

function mapArtifact(
  row: Record<string, unknown>,
): ArtifactRecord {
  return {
    artifactId: String(row.artifact_id),

    taskId: String(row.task_id),

    jobId: String(row.job_id),

    workerId:
      row.worker_id === null
        ? null
        : String(row.worker_id),

    artifactType:
      String(row.artifact_type),

    storageUri:
      String(row.storage_uri),

    sha256:
      String(row.sha256),

    sizeBytes:
      Number(row.size_bytes),

    sampleCount:
      Number(row.sample_count ?? 1),

    modelName:
      String(row.model_name),

    format:
      String(row.format),

    createdAt:
      new Date(
        String(row.created_at),
      ).toISOString(),
  };
}

export async function createArtifact(
  input: CreateArtifactInput,
  executor: QueryExecutor = db,
): Promise<ArtifactRecord> {
  const artifactId = randomUUID();

  const result = await executor.query(
    `
      INSERT INTO artifacts (
        artifact_id,
        task_id,
        job_id,
        worker_id,
        artifact_type,
        storage_uri,
        sha256,
        size_bytes,
        sample_count,
        model_name,
        format
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11
      )
      RETURNING *
    `,
    [
      artifactId,
      input.taskId,
      input.jobId,
      input.workerId ?? null,
      input.artifactType,
      input.storageUri,
      input.sha256,
      input.sizeBytes,
      input.sampleCount ?? 1,
      input.modelName,
      input.format,
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error(
      "Failed to create artifact",
    );
  }

  return mapArtifact(row);
}

export async function findArtifactById(
  artifactId: string,
): Promise<ArtifactRecord | null> {
  const result = await db.query(
    `
      SELECT *
      FROM artifacts
      WHERE artifact_id = $1
    `,
    [artifactId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapArtifact(result.rows[0]);
}

export async function findArtifactsByJobId(
  jobId: string,
): Promise<ArtifactRecord[]> {
  const result = await db.query(
    `
      SELECT *
      FROM artifacts
      WHERE job_id = $1
      ORDER BY created_at ASC
    `,
    [jobId],
  );

  return result.rows.map(mapArtifact);
}

export async function findArtifactsByTaskId(
  taskId: string,
): Promise<ArtifactRecord[]> {
  const result = await db.query(
    `
      SELECT *
      FROM artifacts
      WHERE task_id = $1
      ORDER BY created_at ASC
    `,
    [taskId],
  );

  return result.rows.map(mapArtifact);
}

/**
 * Artifact information required by the aggregation worker.
 *
 * Only completed training tasks that produced a
 * LoRA adapter are returned.
 */
export interface AggregationArtifactRecord
  extends ArtifactRecord {
  sampleCount: number;
}

/**
 * Find all completed training artifacts for a job.
 *
 * This query is intentionally executed using the
 * caller's PoolClient so it participates in the same
 * PostgreSQL transaction as aggregation-task creation.
 */
export async function findTrainingArtifactsForAggregation(
  jobId: string,
  client: PoolClient,
): Promise<AggregationArtifactRecord[]> {
  const result = await client.query(
    `
      SELECT
        a.artifact_id,
        a.task_id,
        a.job_id,
        a.worker_id,
        a.artifact_type,
        a.storage_uri,
        a.sha256,
        a.size_bytes,
        a.sample_count,
        a.model_name,
        a.format,
        a.created_at
      FROM artifacts a
      INNER JOIN tasks t
        ON t.task_id = a.task_id
      WHERE
        a.job_id = $1
        AND a.artifact_type = 'lora_adapter'
        AND t.task_type = 'training'
        AND t.status = 'completed'
      ORDER BY a.created_at ASC
    `,
    [jobId],
  );

  return result.rows.map((row) => ({
    ...mapArtifact(row),
    sampleCount: Number(
      row.sample_count ?? 1,
    ),
  }));
}