import { db } from "../../db/pool.js";

export interface WorkerRecord {
  workerId: string;
  hostname: string;
  cpuCores: number;
  memoryMb: number;
  gpu: boolean;
  gpuModel: string | null;
  vramMb: number | null;
  status: "online" | "offline";
  registeredAt: Date;
  lastHeartbeatAt: Date;
  updatedAt: Date;
}

interface WorkerRow {
  worker_id: string;
  hostname: string;
  cpu_cores: number;
  memory_mb: number;
  gpu: boolean;
  gpu_model: string | null;
  vram_mb: number | null;
  status: "online" | "offline";
  registered_at: Date;
  last_heartbeat_at: Date;
  updated_at: Date;
}

export interface CreateWorkerInput {
  workerId: string;
  hostname: string;
  cpuCores: number;
  memoryMb: number;
  gpu: boolean;
  gpuModel?: string;
  vramMb?: number;
}

function mapWorkerRow(row: WorkerRow): WorkerRecord {
  return {
    workerId: row.worker_id,
    hostname: row.hostname,
    cpuCores: row.cpu_cores,
    memoryMb: row.memory_mb,
    gpu: row.gpu,
    gpuModel: row.gpu_model,
    vramMb: row.vram_mb,
    status: row.status,
    registeredAt: row.registered_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    updatedAt: row.updated_at,
  };
}

export async function findWorkerById(
  workerId: string,
): Promise<WorkerRecord | null> {
  const result = await db.query<WorkerRow>(
    `
      SELECT
        worker_id,
        hostname,
        cpu_cores,
        memory_mb,
        gpu,
        gpu_model,
        vram_mb,
        status,
        registered_at,
        last_heartbeat_at,
        updated_at
      FROM workers
      WHERE worker_id = $1
    `,
    [workerId],
  );

  const row = result.rows[0];

  return row ? mapWorkerRow(row) : null;
}

export async function findAllWorkers(): Promise<WorkerRecord[]> {
  const result = await db.query<WorkerRow>(
    `
      SELECT
        worker_id,
        hostname,
        cpu_cores,
        memory_mb,
        gpu,
        gpu_model,
        vram_mb,
        status,
        registered_at,
        last_heartbeat_at,
        updated_at
      FROM workers
      ORDER BY registered_at ASC
    `,
  );

  return result.rows.map(mapWorkerRow);
}

export async function upsertWorker(
  input: CreateWorkerInput,
): Promise<WorkerRecord> {
  const result = await db.query<WorkerRow>(
    `
      INSERT INTO workers (
        worker_id,
        hostname,
        cpu_cores,
        memory_mb,
        gpu,
        gpu_model,
        vram_mb,
        status,
        registered_at,
        last_heartbeat_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        'online',
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (worker_id)
      DO UPDATE SET
        hostname = EXCLUDED.hostname,
        cpu_cores = EXCLUDED.cpu_cores,
        memory_mb = EXCLUDED.memory_mb,
        gpu = EXCLUDED.gpu,
        gpu_model = EXCLUDED.gpu_model,
        vram_mb = EXCLUDED.vram_mb,
        status = 'online',
        last_heartbeat_at = NOW(),
        updated_at = NOW()
      RETURNING
        worker_id,
        hostname,
        cpu_cores,
        memory_mb,
        gpu,
        gpu_model,
        vram_mb,
        status,
        registered_at,
        last_heartbeat_at,
        updated_at
    `,
    [
      input.workerId,
      input.hostname,
      input.cpuCores,
      input.memoryMb,
      input.gpu,
      input.gpuModel ?? null,
      input.vramMb ?? null,
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Failed to upsert worker");
  }

  return mapWorkerRow(row);
}

export async function updateWorkerHeartbeat(
  workerId: string,
): Promise<WorkerRecord | null> {
  const result = await db.query<WorkerRow>(
    `
      UPDATE workers
      SET
        status = 'online',
        last_heartbeat_at = NOW(),
        updated_at = NOW()
      WHERE worker_id = $1
      RETURNING
        worker_id,
        hostname,
        cpu_cores,
        memory_mb,
        gpu,
        gpu_model,
        vram_mb,
        status,
        registered_at,
        last_heartbeat_at,
        updated_at
    `,
    [workerId],
  );

  const row = result.rows[0];

  return row ? mapWorkerRow(row) : null;
}

export async function markStaleWorkersOffline(
  timeoutSeconds: number,
): Promise<WorkerRecord[]> {
  const result = await db.query<WorkerRow>(
    `
      UPDATE workers
      SET
        status = 'offline',
        updated_at = NOW()
      WHERE
        status = 'online'
        AND last_heartbeat_at < NOW() - ($1 * INTERVAL '1 second')
      RETURNING
        worker_id,
        hostname,
        cpu_cores,
        memory_mb,
        gpu,
        gpu_model,
        vram_mb,
        status,
        registered_at,
        last_heartbeat_at,
        updated_at
    `,
    [timeoutSeconds],
  );

  return result.rows.map(mapWorkerRow);
}