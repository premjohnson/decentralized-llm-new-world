import { randomUUID } from "node:crypto";
import { db } from "../../db/pool.js";

import type {
  RegisterModelInput,
  ModelStatus,
} from "./model.schema.js";

export interface ModelRecord {
  modelId: string;
  modelName: string;
  version: string;
  artifactId: string;
  status: ModelStatus;
  baseModelName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function mapModel(
  row: Record<string, unknown>,
): ModelRecord {
  return {
    modelId: String(row.model_id),
    modelName: String(row.model_name),
    version: String(row.version),
    artifactId: String(row.artifact_id),
    status: row.status as ModelStatus,
    baseModelName:
      row.base_model_name === null
        ? null
        : String(row.base_model_name),
    metadata:
      typeof row.metadata === "object" &&
      row.metadata !== null
        ? row.metadata as Record<string, unknown>
        : {},
    createdAt:
      new Date(
        String(row.created_at),
      ).toISOString(),
    updatedAt:
      new Date(
        String(row.updated_at),
      ).toISOString(),
  };
}

export async function registerModel(
  input: RegisterModelInput,
): Promise<ModelRecord> {
  const modelId = randomUUID();

  const result = await db.query(
    `
      INSERT INTO model_registry (
        model_id,
        model_name,
        version,
        artifact_id,
        base_model_name,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6
      )
      RETURNING *
    `,
    [
      modelId,
      input.modelName,
      input.version,
      input.artifactId,
      input.baseModelName ?? null,
      JSON.stringify(input.metadata),
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error(
      "Failed to register model",
    );
  }

  return mapModel(row);
}

export async function findModelById(
  modelId: string,
): Promise<ModelRecord | null> {
  const result = await db.query(
    `
      SELECT *
      FROM model_registry
      WHERE model_id = $1
    `,
    [modelId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapModel(result.rows[0]);
}

export async function findModelByNameAndVersion(
  modelName: string,
  version: string,
): Promise<ModelRecord | null> {
  const result = await db.query(
    `
      SELECT *
      FROM model_registry
      WHERE model_name = $1
        AND version = $2
    `,
    [modelName, version],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapModel(result.rows[0]);
}

export async function findReadyModelByName(
  modelName: string,
): Promise<ModelRecord | null> {
  const result = await db.query(
    `
      SELECT *
      FROM model_registry
      WHERE model_name = $1
        AND status = 'ready'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [modelName],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapModel(result.rows[0]);
}

export async function updateModelStatus(
  modelId: string,
  status: ModelStatus,
): Promise<ModelRecord | null> {
  const result = await db.query(
    `
      UPDATE model_registry
      SET
        status = $2,
        updated_at = NOW()
      WHERE model_id = $1
      RETURNING *
    `,
    [modelId, status],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapModel(result.rows[0]);
}
