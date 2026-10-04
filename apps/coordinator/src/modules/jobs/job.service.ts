import { randomUUID } from "node:crypto";

import { withTransaction } from "../../db/transaction.js";

import {
  createJob,
  findAllJobs,
  findJobById,
  type JobRecord,
} from "./job.repository.js";

import { createTask } from "./task.repository.js";

import type { CreateJobInput } from "./job.schema.js";

export async function createJobService(
  input: CreateJobInput,
): Promise<JobRecord> {
  const jobId = randomUUID();

  const workerCount = getWorkerCount(input.config);

  return withTransaction(async (client) => {
    /*
     * Create the job and all initial tasks
     * inside the same PostgreSQL transaction.
     *
     * If any task creation fails, the entire
     * transaction is rolled back.
     */
    const job = await createJob(
      {
        jobId,
        name: input.name,
        jobType: input.jobType,
        modelName: input.modelName,
        datasetName: input.datasetName,
        config: input.config,
      },
      client,
    );

    for (let index = 0; index < workerCount; index += 1) {
      await createTask(
        {
          taskId: randomUUID(),
          jobId,
          taskType: input.jobType,
          payload: buildTaskPayload(input, index, workerCount),
        },
        client,
      );
    }

    return job;
  });
}

function buildTaskPayload(
  input: CreateJobInput,
  taskIndex: number,
  totalTasks: number,
): Record<string, unknown> {
  const basePayload: Record<string, unknown> = {
    modelName: input.modelName,
    datasetName: input.datasetName ?? null,
    config: input.config,
    taskIndex,
    totalTasks,
  };

  switch (input.jobType) {
    case "inference":
      return {
        ...basePayload,
        prompt: input.config.prompt,
        maxTokens: input.config.maxTokens ?? 128,
        temperature: input.config.temperature ?? 0.7,
        requestId: randomUUID(),
      };

    case "training":
      return {
        ...basePayload,
        epochs: input.config.epochs,
        batchSize: input.config.batchSize,
        learningRate: input.config.learningRate,
      };

    case "evaluation":
      return {
        ...basePayload,
        metrics: input.config.metrics,
      };

    default:
      return basePayload;
  }
}

function getWorkerCount(
  config: Record<string, unknown>,
): number {
  const workers = config.workers;

  if (workers === undefined) {
    return 1;
  }

  if (
    typeof workers !== "number" ||
    !Number.isInteger(workers) ||
    workers < 1 ||
    workers > 100
  ) {
    throw new Error(
      "config.workers must be an integer between 1 and 100",
    );
  }

  return workers;
}

export async function getJobByIdService(
  jobId: string,
): Promise<JobRecord | null> {
  return findJobById(jobId);
}

export async function getAllJobsService(): Promise<JobRecord[]> {
  return findAllJobs();
}