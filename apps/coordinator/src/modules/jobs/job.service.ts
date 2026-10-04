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

  const trainingPartitions =
    input.jobType === "training"
      ? partitionDataset(
          input.config.dataset,
          workerCount,
        )
      : null;

  return withTransaction(async (client) => {
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
          payload: buildTaskPayload(
            input,
            index,
            workerCount,
            trainingPartitions,
          ),
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
  trainingPartitions: string[][] | null,
): Record<string, unknown> {
  const basePayload = {
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

        maxTokens:
          input.config.maxTokens ?? 128,

        temperature:
          input.config.temperature ?? 0.7,

        requestId: randomUUID(),
      };

    case "training": {
      if (!trainingPartitions) {
        throw new Error(
          "Training dataset partitions were not created.",
        );
      }

      const dataset = trainingPartitions[taskIndex];

      if (!dataset || dataset.length === 0) {
        throw new Error(
          `Training task ${taskIndex} received an empty dataset partition.`,
        );
      }

      return {
        ...basePayload,

        // IMPORTANT:
        // Each training task receives ONLY its own partition.
        dataset,

        epochs:
          input.config.epochs ?? 1,

        batchSize:
          input.config.batchSize ?? 1,

        learningRate:
          input.config.learningRate ?? 2e-4,

        maxLength:
          input.config.maxLength ?? 128,

        lora: input.config.lora ?? {
          r: 8,
          alpha: 16,
          dropout: 0.05,
        },

        gradientAccumulationSteps: 1,
      };
    }

    case "evaluation": {
      const dataset = input.config.dataset;

      if (!Array.isArray(dataset) || dataset.length === 0) {
        throw new Error(
          "Evaluation dataset must contain at least one sample.",
        );
      }

      const normalizedDataset = dataset.map(
        (sample, index) => {
          if (
            typeof sample !== "string" ||
            sample.trim().length === 0
          ) {
            throw new Error(
              `Evaluation dataset sample ${index} must be a non-empty string.`,
            );
          }

          return sample;
        },
      );

      return {
        ...basePayload,

        dataset: normalizedDataset,

        metrics: input.config.metrics,

        maxLength:
          input.config.maxLength ?? 512,
      };
    }

    default:
      return basePayload;
  }
}

function partitionDataset(
  dataset: unknown,
  workerCount: number,
): string[][] {
  if (!Array.isArray(dataset)) {
    throw new Error(
      "Training config.dataset must be an array.",
    );
  }

  if (dataset.length === 0) {
    throw new Error(
      "Training dataset must contain at least one sample.",
    );
  }

  if (workerCount > dataset.length) {
    throw new Error(
      `Training workers (${workerCount}) cannot exceed dataset samples (${dataset.length}).`,
    );
  }

  const normalizedDataset = dataset.map(
    (sample, index) => {
      if (
        typeof sample !== "string" ||
        sample.trim().length === 0
      ) {
        throw new Error(
          `Training dataset sample ${index} must be a non-empty string.`,
        );
      }

      return sample;
    },
  );

  const partitions: string[][] = Array.from(
    { length: workerCount },
    () => [],
  );

  /*
   * Deterministic balanced partitioning.
   *
   * Example:
   *
   * dataset = [A, B, C, D, E]
   * workers = 2
   *
   * Worker 0 -> [A, B, C]
   * Worker 1 -> [D, E]
   *
   * Difference between partition sizes is never
   * more than one sample.
   */
  const baseSize = Math.floor(
    normalizedDataset.length / workerCount,
  );

  const remainder =
    normalizedDataset.length % workerCount;

  let offset = 0;

  for (
    let workerIndex = 0;
    workerIndex < workerCount;
    workerIndex += 1
  ) {
    const partitionSize =
      baseSize +
      (workerIndex < remainder ? 1 : 0);

    partitions[workerIndex] =
      normalizedDataset.slice(
        offset,
        offset + partitionSize,
      );

    offset += partitionSize;
  }

  return partitions;
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

export async function getAllJobsService(): Promise<
  JobRecord[]
> {
  return findAllJobs();
}