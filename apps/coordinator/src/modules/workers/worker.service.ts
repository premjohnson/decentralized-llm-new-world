import type { RegisterWorkerInput } from "./worker.schema.js";
import {
  findAllWorkers,
  findWorkerById,
  upsertWorker,
  updateWorkerHeartbeat,
  markStaleWorkersOffline as markStaleWorkersOfflineInDatabase,
  type WorkerRecord,
} from "./worker.repository.js";

export interface Worker {
  workerId: string;
  hostname: string;
  capabilities: RegisterWorkerInput["capabilities"];
  status: "online" | "offline";
  registeredAt: string;
  lastHeartbeatAt: string;
}

function toWorker(record: WorkerRecord): Worker {
  return {
    workerId: record.workerId,
    hostname: record.hostname,
    capabilities: {
      cpuCores: record.cpuCores,
      memoryMb: record.memoryMb,
      gpu: record.gpu,
      ...(record.gpuModel !== null
        ? { gpuModel: record.gpuModel }
        : {}),
      ...(record.vramMb !== null
        ? { vramMb: record.vramMb }
        : {}),
    },
    status: record.status,
    registeredAt: record.registeredAt.toISOString(),
    lastHeartbeatAt: record.lastHeartbeatAt.toISOString(),
  };
}

export async function registerWorker(
  input: RegisterWorkerInput,
): Promise<Worker> {
  const worker = await upsertWorker({
    workerId: input.workerId,
    hostname: input.hostname,
    cpuCores: input.capabilities.cpuCores,
    memoryMb: input.capabilities.memoryMb,
    gpu: input.capabilities.gpu,
    gpuModel: input.capabilities.gpuModel,
    vramMb: input.capabilities.vramMb,
  });

  return toWorker(worker);
}

export async function getWorkers(): Promise<Worker[]> {
  const workers = await findAllWorkers();

  return workers.map(toWorker);
}

export async function getWorker(
  workerId: string,
): Promise<Worker | undefined> {
  const worker = await findWorkerById(workerId);

  if (!worker) {
    return undefined;
  }

  return toWorker(worker);
}

export async function heartbeatWorker(
  workerId: string,
): Promise<Worker | undefined> {
  const worker = await updateWorkerHeartbeat(workerId);

  if (!worker) {
    return undefined;
  }

  return toWorker(worker);
}

export async function markStaleWorkersOffline(
  timeoutSeconds: number,
): Promise<Worker[]> {
  const workers =
    await markStaleWorkersOfflineInDatabase(timeoutSeconds);

  return workers.map(toWorker);
}