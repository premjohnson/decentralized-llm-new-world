const API_BASE_URL =
  import.meta.env.VITE_COORDINATOR_API_URL ??
  "http://localhost:4000/api/v1";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${path}`);
  }

  return response.json() as Promise<T>;
}

export interface TrainingJob {
  jobId: string;
  name: string;
  jobType: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  modelName: string;
  datasetName: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Worker {
  workerId: string;
  hostname: string;
  status: "online" | "offline";
  registeredAt: string;
  lastHeartbeatAt: string;
  capabilities: {
    cpuCores: number;
    memoryMb: number;
    gpu: boolean;
    gpuModel?: string;
    vramMb?: number;
  };
}

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

export async function fetchJobs(): Promise<TrainingJob[]> {
  return get<TrainingJob[]>("/jobs");
}

export async function fetchWorkers(): Promise<Worker[]> {
  const result = await get<{ data: Worker[] }>("/workers");
  return result.data;
}

export async function fetchWorkerTelemetry(): Promise<WorkerTelemetry[]> {
  const result = await get<{ data: WorkerTelemetry[] }>("/workers/telemetry");
  return result.data;
}

export async function fetchCoordinatorHealth(): Promise<boolean> {
  const response = await fetch(
    `${API_BASE_URL.replace(/\/api\/v1\/?$/, "")}/health`,
  );

  return response.ok;
}
