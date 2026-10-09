import { db } from "../../db/pool.js";
import type { WorkerTelemetryInput } from "./telemetry.schema.js";

export interface WorkerTelemetry {
  workerId: string;
  cpuUsagePercent: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  gpuUtilizationPercent: number | null;
  gpuMemoryUsedMb: number | null;
  gpuMemoryTotalMb: number | null;
  collectedAt: string;
  receivedAt: string;
}

interface TelemetryRow {
  worker_id: string;
  cpu_usage_percent: number | null;
  memory_used_mb: string | number | null;
  memory_total_mb: string | number | null;
  gpu_utilization_percent: number | null;
  gpu_memory_used_mb: string | number | null;
  gpu_memory_total_mb: string | number | null;
  collected_at: Date;
  received_at: Date;
}

function mapRow(row: TelemetryRow): WorkerTelemetry {
  return {
    workerId: row.worker_id,
    cpuUsagePercent:
      row.cpu_usage_percent === null
        ? null
        : Number(row.cpu_usage_percent),
    memoryUsedMb:
      row.memory_used_mb === null
        ? null
        : Number(row.memory_used_mb),
    memoryTotalMb:
      row.memory_total_mb === null
        ? null
        : Number(row.memory_total_mb),
    gpuUtilizationPercent:
      row.gpu_utilization_percent === null
        ? null
        : Number(row.gpu_utilization_percent),
    gpuMemoryUsedMb:
      row.gpu_memory_used_mb === null
        ? null
        : Number(row.gpu_memory_used_mb),
    gpuMemoryTotalMb:
      row.gpu_memory_total_mb === null
        ? null
        : Number(row.gpu_memory_total_mb),
    collectedAt: row.collected_at.toISOString(),
    receivedAt: row.received_at.toISOString(),
  };
}

const columns = `
  worker_id,
  cpu_usage_percent,
  memory_used_mb,
  memory_total_mb,
  gpu_utilization_percent,
  gpu_memory_used_mb,
  gpu_memory_total_mb,
  collected_at,
  received_at
`;

export async function upsertWorkerTelemetry(
  workerId: string,
  input: WorkerTelemetryInput,
): Promise<WorkerTelemetry> {
  const result = await db.query<TelemetryRow>(
    `
      INSERT INTO worker_telemetry (
        worker_id,
        cpu_usage_percent,
        memory_used_mb,
        memory_total_mb,
        gpu_utilization_percent,
        gpu_memory_used_mb,
        gpu_memory_total_mb,
        collected_at,
        received_at
      )
      SELECT
        $1::varchar,
        $2::double precision,
        $3::bigint,
        $4::bigint,
        $5::double precision,
        $6::bigint,
        $7::bigint,
        $8::timestamptz,
        NOW()
      WHERE EXISTS (
        SELECT 1
        FROM workers
        WHERE worker_id = $1::varchar
      )
      ON CONFLICT (worker_id) DO UPDATE SET
        cpu_usage_percent = EXCLUDED.cpu_usage_percent,
        memory_used_mb = EXCLUDED.memory_used_mb,
        memory_total_mb = EXCLUDED.memory_total_mb,
        gpu_utilization_percent = EXCLUDED.gpu_utilization_percent,
        gpu_memory_used_mb = EXCLUDED.gpu_memory_used_mb,
        gpu_memory_total_mb = EXCLUDED.gpu_memory_total_mb,
        collected_at = EXCLUDED.collected_at,
        received_at = NOW()
      WHERE worker_telemetry.collected_at <= EXCLUDED.collected_at
      RETURNING ${columns}
    `,
    [
      workerId,
      input.cpuUsagePercent,
      input.memoryUsedMb,
      input.memoryTotalMb,
      input.gpuUtilizationPercent,
      input.gpuMemoryUsedMb,
      input.gpuMemoryTotalMb,
      input.collectedAt,
    ],
  );

  if (result.rows[0]) {
    return mapRow(result.rows[0]);
  }

  const worker = await db.query(
    "SELECT 1 FROM workers WHERE worker_id = $1::varchar",
    [workerId],
  );

  if (worker.rowCount === 0) {
    throw new Error("WORKER_NOT_FOUND");
  }

  const existing = await getWorkerTelemetry(workerId);

  if (existing) {
    throw new Error("STALE_TELEMETRY");
  }

  throw new Error("TELEMETRY_WRITE_FAILED");
}

export async function getWorkerTelemetry(
  workerId: string,
): Promise<WorkerTelemetry | null> {
  const result = await db.query<TelemetryRow>(
    `SELECT ${columns} FROM worker_telemetry WHERE worker_id = $1`,
    [workerId],
  );

  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getAllWorkerTelemetry(): Promise<WorkerTelemetry[]> {
  const result = await db.query<TelemetryRow>(
    `
      SELECT ${columns}
      FROM worker_telemetry
      ORDER BY worker_id ASC
    `,
  );

  return result.rows.map(mapRow);
}
