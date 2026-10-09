import {
  createHash,
  randomUUID,
} from "node:crypto";

import { withTransaction } from "../../db/transaction.js";

import {
  createJob,
  findAllJobs,
  findJobById,
  type JobRecord,
} from "./job.repository.js";

import { createTask } from "./task.repository.js";

import {
  getLatestModelByName,
  getReadyModel,
} from "../models/model.service.js";

import { createBlockchainOutboxEvent } from "../blockchain/blockchain.outbox.repository.js";

import type { CreateJobInput } from "./job.schema.js";

/**
 * Create a new job and its worker tasks.
 *
 * Inference jobs require the requested model to be
 * registered and currently READY in the Model Registry.
 *
 * Training jobs do not require the model to already
 * exist in the Model Registry because training can
 * produce a new model version.
 *
 * Evaluation jobs retain their existing behavior.
 *
 * For training jobs, a REGISTER_JOB blockchain outbox
 * event is created atomically with the job and its tasks.
 */
export async function createJobService(
  input: CreateJobInput,
): Promise<JobRecord> {
  const jobId = randomUUID();

  const workerCount = getWorkerCount(
    input.config,
  );

  /*
   * Inference jobs may only run against a model
   * that is currently READY in the Model Registry.
   */
  if (input.jobType === "inference") {
    const model = await getReadyModel(
      input.modelName,
    );

    if (!model) {
      throw new Error(
        `Model '${input.modelName}' is not ready for inference.`,
      );
    }
  }

  /*
   * Training jobs may optionally resolve the latest
   * registered model.
   *
   * We deliberately do not reject the training job
   * when the model does not exist.
   *
   * If a model exists, its version is used for the
   * blockchain registration event.
   *
   * Otherwise, the blockchain registration uses the
   * explicit "training" version marker.
   */
  const trainingModel =
    input.jobType === "training"
      ? await getLatestModelByName(
          input.modelName,
        )
      : null;

  /*
   * Normalize the complete training dataset once.
   *
   * The same canonical dataset is used for:
   *
   * 1. Worker partitioning
   * 2. Blockchain dataset hashing
   */
  const trainingDataset =
    input.jobType === "training"
      ? normalizeTrainingDataset(
          getTrainingDataset(input),
        )
      : null;

  const trainingPartitions =
    trainingDataset !== null
      ? partitionDataset(
          trainingDataset,
          workerCount,
        )
      : null;

  const trainingDatasetHash =
    trainingDataset !== null
      ? hashDataset(trainingDataset)
      : null;

  return withTransaction(async (client) => {
    /*
     * Create the primary job record.
     */
    const job = await createJob(
      {
        jobId,
        name: input.name,
        jobType: input.jobType,
        modelName: input.modelName,
        datasetName:
          input.datasetName,
        config: input.config,
      },
      client,
    );

    /*
     * Create worker tasks.
     */
    for (
      let index = 0;
      index < workerCount;
      index += 1
    ) {
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

    /*
     * Create the blockchain registration event
     * for every training job that has a valid
     * dataset hash.
     *
     * IMPORTANT:
     *
     * This event participates in the SAME
     * PostgreSQL transaction as the job and tasks.
     *
     * No Solana RPC call happens here.
     *
     * The BlockchainOutboxWorker processes this
     * event asynchronously after the transaction
     * commits.
     */
    if (
      input.jobType === "training" &&
      trainingDatasetHash
    ) {
      await createBlockchainOutboxEvent(
        {
          jobId,
          eventType: "REGISTER_JOB",

          payload: {
            jobId,

            modelName:
              input.modelName,

            modelVersion:
              trainingModel?.version ??
              "training",

            workerCount,

            datasetHash:
              trainingDatasetHash,
          },

          idempotencyKey:
            `REGISTER_JOB:${jobId}`,
        },
        client,
      );
    }

    return job;
  });
}

/**
 * Extract the training dataset from the generic
 * job configuration.
 *
 * The current CreateJobInput type exposes config
 * broadly enough that TypeScript cannot infer that
 * dataset exists merely from jobType.
 */
function getTrainingDataset(
  input: CreateJobInput,
): string[] {
  const config =
    input.config as Record<
      string,
      unknown
    >;

  const dataset =
    config.dataset;

  if (!Array.isArray(dataset)) {
    throw new Error(
      "Training dataset must be an array.",
    );
  }

  if (
    !dataset.every(
      (item): item is string =>
        typeof item === "string",
    )
  ) {
    throw new Error(
      "Training dataset must contain only strings.",
    );
  }

  return dataset;
}

/**
 * Build the payload sent to an individual worker task.
 */
function buildTaskPayload(
  input: CreateJobInput,
  taskIndex: number,
  totalTasks: number,
  trainingPartitions: string[][] | null,
): Record<string, unknown> {
  const basePayload = {
    modelName:
      input.modelName,

    datasetName:
      input.datasetName ?? null,

    config:
      input.config,

    taskIndex,

    totalTasks,
  };

  switch (input.jobType) {
    case "inference":
      return {
        ...basePayload,

        prompt:
          input.config.prompt,

        maxTokens:
          input.config.maxTokens ??
          128,

        temperature:
          input.config.temperature ??
          0.7,

        requestId:
          randomUUID(),
      };

    case "training": {
      if (!trainingPartitions) {
        throw new Error(
          "Training dataset partitions were not created.",
        );
      }

      const dataset =
        trainingPartitions[
          taskIndex
        ];

      if (
        !dataset ||
        dataset.length === 0
      ) {
        throw new Error(
          `Training task ${taskIndex} received an empty dataset partition.`,
        );
      }

      return {
        ...basePayload,

        dataset,

        epochs:
          input.config.epochs,

        batchSize:
          input.config.batchSize,

        learningRate:
          input.config.learningRate,

        maxLength:
          input.config.maxLength,
      };
    }

    case "evaluation":
      return {
        ...basePayload,

        dataset:
          input.config.dataset,

        metrics:
          input.config.metrics,
      };

    default:
      throw new Error(
        `Unsupported job type: ${input.jobType}`,
      );
  }
}

/**
 * Determine how many worker tasks should be created.
 */
function getWorkerCount(
  config: CreateJobInput["config"],
): number {
  const configRecord =
    config as Record<
      string,
      unknown
    >;

  const workers =
    typeof configRecord.workers ===
    "number"
      ? configRecord.workers
      : 1;

  if (
    !Number.isSafeInteger(workers) ||
    workers <= 0
  ) {
    throw new Error(
      "workers must be a positive integer.",
    );
  }

  return workers;
}

/**
 * Normalize a training dataset into a canonical
 * string array.
 *
 * This guarantees that the exact same representation
 * is used for:
 *
 * - worker partitioning
 * - SHA-256 hashing
 */
function normalizeTrainingDataset(
  dataset: string[],
): string[] {
  return dataset.map(
    (item) => item.trim(),
  );
}

/**
 * Split the dataset across worker tasks.
 *
 * Every worker must receive at least one sample.
 */
function partitionDataset(
  dataset: string[],
  workerCount: number,
): string[][] {
  if (dataset.length === 0) {
    throw new Error(
      "Training dataset must not be empty.",
    );
  }

  if (
    !Number.isSafeInteger(workerCount) ||
    workerCount <= 0
  ) {
    throw new Error(
      "workerCount must be a positive integer.",
    );
  }

  if (
    workerCount > dataset.length
  ) {
    throw new Error(
      `Training workers (${workerCount}) cannot exceed dataset samples (${dataset.length}).`,
    );
  }

  const partitions: string[][] =
    Array.from(
      {
        length: workerCount,
      },
      () => [],
    );

  dataset.forEach(
    (item, index) => {
      const partitionIndex =
        index % workerCount;

      const partition =
        partitions[
          partitionIndex
        ];

      if (!partition) {
        throw new Error(
          `Failed to resolve dataset partition ${partitionIndex}.`,
        );
      }

      partition.push(item);
    },
  );

  return partitions;
}

/**
 * Create the deterministic SHA-256 hash used
 * by the blockchain TrainingJob account.
 */
function hashDataset(
  dataset: string[],
): string {
  const canonicalDataset =
    JSON.stringify(dataset);

  return createHash("sha256")
    .update(canonicalDataset)
    .digest("hex");
}

/**
 * Get all jobs.
 */
export async function getAllJobsService(): Promise<
  JobRecord[]
> {
  return findAllJobs();
}

/**
 * Get a single job by ID.
 */
export async function getJobByIdService(
  jobId: string,
): Promise<JobRecord | null> {
  return findJobById(jobId);
}