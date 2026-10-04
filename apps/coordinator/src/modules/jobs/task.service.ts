import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { withTransaction } from "../../db/transaction.js";

import {
  findJobById,
  reconcileJobStatus,
} from "../jobs/job.repository.js";

import {
  createTask,
  findTaskById,
  findTasksByJobId,
  claimNextPendingTask,
  markTaskRunning,
  markTaskCompleted,
  markTaskFailed,
  requeueTask,
  type TaskRecord,
} from "./task.repository.js";

import {
  createArtifact,
  findTrainingArtifactsForAggregation,
} from "../artifacts/artifact.repository.js";

import type {
  CreateTaskInput,
  TaskResultInput,
} from "./task.schema.js";

/*
 * Create a new task for an existing job.
 */
export async function createTaskService(
  input: CreateTaskInput,
): Promise<TaskRecord> {
  const job = await findJobById(input.jobId);

  if (!job) {
    throw new Error("Job not found");
  }

  /*
   * Terminal jobs cannot receive new tasks.
   */
  if (
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "cancelled"
  ) {
    throw new Error(
      `Cannot create task for job in ${job.status} state`,
    );
  }

  return createTask({
    taskId: randomUUID(),
    jobId: input.jobId,
    taskType: input.taskType,
    payload: input.payload,
    maxAttempts: input.maxAttempts,
  });
}

/*
 * Get a task by ID.
 */
export async function getTaskByIdService(
  taskId: string,
): Promise<TaskRecord | null> {
  return findTaskById(taskId);
}

/*
 * Get all tasks belonging to a job.
 */
export async function getTasksByJobIdService(
  jobId: string,
): Promise<TaskRecord[]> {
  const job = await findJobById(jobId);

  if (!job) {
    throw new Error("Job not found");
  }

  return findTasksByJobId(jobId);
}

/*
 * Claim the oldest available pending task.
 *
 * The repository uses PostgreSQL FOR UPDATE SKIP LOCKED,
 * so multiple workers can safely claim tasks concurrently.
 */
export async function claimNextTaskService(
  workerId: string,
): Promise<TaskRecord | null> {
  return claimNextPendingTask(workerId);
}

/*
 * Move an assigned task to running.
 */
export async function markTaskRunningService(
  taskId: string,
  workerId: string,
): Promise<TaskRecord | null> {
  return markTaskRunning(taskId, workerId);
}

/*
 * Register an artifact produced by a completed task.
 *
 * Artifact registration happens inside the same transaction
 * as task completion.
 */
async function registerTaskArtifact(
  result: unknown,
  client: PoolClient,
): Promise<void> {
  if (!result || typeof result !== "object") {
    return;
  }

  const resultRecord =
    result as Record<string, unknown>;

  const artifact = resultRecord.artifact;

  if (
    !artifact ||
    typeof artifact !== "object"
  ) {
    return;
  }

  const artifactRecord =
    artifact as Record<string, unknown>;

  /*
   * Supported artifact types.
   */
  if (
    artifactRecord.artifactType !==
      "lora_adapter" &&
    artifactRecord.artifactType !==
      "model_checkpoint" &&
    artifactRecord.artifactType !==
      "evaluation_result"
  ) {
    throw new Error(
      `Unsupported artifact type: ${String(
        artifactRecord.artifactType,
      )}`,
    );
  }

  const jobId =
    artifactRecord.jobId;

  const taskId =
    artifactRecord.taskId;

  const workerId =
    artifactRecord.workerId;

  const storageUri =
    artifactRecord.storageUri;

  const sha256 =
    artifactRecord.sha256;

  const sizeBytes =
    artifactRecord.sizeBytes;

  const sampleCount =
    artifactRecord.sampleCount;

  const modelName =
    artifactRecord.modelName;

  const format =
    artifactRecord.format;

  if (
    typeof jobId !== "string" ||
    typeof taskId !== "string" ||
    typeof workerId !== "string" ||
    typeof storageUri !== "string" ||
    typeof sha256 !== "string" ||
    typeof sizeBytes !== "number" ||
    typeof modelName !== "string" ||
    typeof format !== "string"
  ) {
    throw new Error(
      "Training artifact metadata is incomplete.",
    );
  }

  if (
    !/^[a-fA-F0-9]{64}$/.test(
      sha256,
    )
  ) {
    throw new Error(
      "Training artifact SHA-256 must contain exactly 64 hexadecimal characters.",
    );
  }

  if (
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 0
  ) {
    throw new Error(
      "Training artifact sizeBytes must be a non-negative integer.",
    );
  }

  /*
   * LoRA adapters participate in FedAvg, so their
   * sample count must be a positive integer.
   */
  if (
    artifactRecord.artifactType ===
    "lora_adapter"
  ) {
    if (
      typeof sampleCount !== "number" ||
      !Number.isInteger(sampleCount) ||
      sampleCount <= 0
    ) {
      throw new Error(
        "LoRA artifact sampleCount must be a positive integer.",
      );
    }
  }

  await createArtifact(
    {
      taskId,
      jobId,
      workerId,
      artifactType:
        artifactRecord.artifactType as
          | "lora_adapter"
          | "model_checkpoint"
          | "evaluation_result",
      storageUri,
      sha256,
      sizeBytes,

      /*
       * Preserve the worker-reported sample count.
       *
       * The database defaults to 1, but training artifacts
       * must explicitly persist their real sample count.
       */
      sampleCount:
        typeof sampleCount === "number"
          ? sampleCount
          : undefined,

      modelName,
      format,
    },
    client,
  );
}

/*
 * Ensure the aggregation task exists for a training job.
 *
 * This function MUST execute inside the same PostgreSQL
 * transaction as training-task completion.
 *
 * Lifecycle:
 *
 *   training tasks
 *        ↓
 *   all training tasks completed
 *        ↓
 *   all LoRA artifacts registered
 *        ↓
 *   create exactly one aggregation task
 */
async function ensureAggregationTask(
  jobId: string,
  client: PoolClient,
): Promise<TaskRecord | null> {
  /*
   * Lock the parent job so concurrent task-completion
   * transactions cannot create duplicate aggregation tasks.
   */
  const jobResult = await client.query<{
    job_id: string;
    job_type: "training" | "inference" | "evaluation";
    model_name: string;
  }>(
    `
      SELECT
        job_id,
        job_type,
        model_name
      FROM jobs
      WHERE job_id = $1
      FOR UPDATE
    `,
    [jobId],
  );

  const job = jobResult.rows[0];

  if (!job) {
    throw new Error(
      `Job ${jobId} not found while creating aggregation task`,
    );
  }

  /*
   * Aggregation is only required for training jobs.
   */
  if (job.job_type !== "training") {
    return null;
  }

  /*
   * Check whether an aggregation task already exists.
   *
   * The database partial unique index also protects us,
   * but this check avoids unnecessary INSERT attempts.
   */
  const existingAggregationResult =
    await client.query<{
      task_id: string;
    }>(
      `
        SELECT task_id
        FROM tasks
        WHERE
          job_id = $1
          AND task_type = 'aggregation'
        LIMIT 1
      `,
      [jobId],
    );

  const existingAggregation =
    existingAggregationResult.rows[0];

  if (existingAggregation) {
    return findTaskByIdWithClient(
      existingAggregation.task_id,
      client,
    );
  }

  /*
   * Count all training tasks and completed training tasks.
   */
  const trainingCountResult =
    await client.query<{
      total_training_tasks: string;
      completed_training_tasks: string;
    }>(
      `
        SELECT
          COUNT(*)::text AS total_training_tasks,

          COUNT(*) FILTER (
            WHERE status = 'completed'
          )::text AS completed_training_tasks

        FROM tasks
        WHERE
          job_id = $1
          AND task_type = 'training'
      `,
      [jobId],
    );

  const trainingCounts =
    trainingCountResult.rows[0];

  if (!trainingCounts) {
    throw new Error(
      `Failed to read training task state for job ${jobId}`,
    );
  }

  const totalTrainingTasks =
    Number(
      trainingCounts.total_training_tasks,
    );

  const completedTrainingTasks =
    Number(
      trainingCounts.completed_training_tasks,
    );

  /*
   * Nothing to aggregate until every training task
   * has completed.
   */
  if (
    totalTrainingTasks === 0 ||
    completedTrainingTasks !==
      totalTrainingTasks
  ) {
    return null;
  }

  /*
   * Fetch the completed training LoRA artifacts.
   */
  const artifacts =
    await findTrainingArtifactsForAggregation(
      jobId,
      client,
    );

  /*
   * Every completed training task must have exactly one
   * LoRA artifact before aggregation can start.
   */
  if (
    artifacts.length !==
    totalTrainingTasks
  ) {
    throw new Error(
      `Cannot create aggregation task for job ${jobId}: ` +
        `expected ${totalTrainingTasks} training artifacts, ` +
        `found ${artifacts.length}`,
    );
  }

  /*
   * Build the aggregation payload.
   *
   * FedAvg uses:
   *
   *   weighted_average =
   *     Σ(adapter_i × sample_count_i)
   *     / Σ(sample_count_i)
   */
  const aggregationPayload = {
    modelName: job.model_name,

    artifacts: artifacts.map(
      (artifact) => ({
        path:
          artifact.storageUri,

        sampleCount:
          artifact.sampleCount,

        sha256:
          artifact.sha256,

        workerId:
          artifact.workerId,

        taskId:
          artifact.taskId,
      }),
    ),
  };

  /*
   * Create exactly one aggregation task.
   *
   * Migration 006 provides an additional database-level
   * uniqueness guarantee:
   *
   *   one aggregation task per job.
   */
  const aggregationTask =
    await createTask(
      {
        taskId: randomUUID(),

        jobId,

        taskType:
          "aggregation",

        payload:
          aggregationPayload,

        maxAttempts: 3,
      },
      client,
    );

  return aggregationTask;
}

/*
 * Read a task using the current transaction client.
 *
 * This is intentionally local to this service because
 * findTaskById() uses the global database pool.
 */
async function findTaskByIdWithClient(
  taskId: string,
  client: PoolClient,
): Promise<TaskRecord | null> {
  const result = await client.query(
    `
      SELECT
        task_id,
        job_id,
        worker_id,
        task_type,
        status,
        payload,
        result,
        attempt,
        max_attempts,
        error_message,
        created_at,
        updated_at,
        assigned_at,
        started_at,
        completed_at,
        failed_at
      FROM tasks
      WHERE task_id = $1
    `,
    [taskId],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    taskId: String(row.task_id),

    jobId: String(row.job_id),

    workerId:
      row.worker_id === null
        ? null
        : String(row.worker_id),

    taskType:
      row.task_type,

    status:
      row.status,

    payload:
      row.payload ?? {},

    result:
      row.result ?? null,

    attempt:
      Number(row.attempt),

    maxAttempts:
      Number(row.max_attempts),

    errorMessage:
      row.error_message === null
        ? null
        : String(row.error_message),

    createdAt:
      new Date(
        row.created_at,
      ),

    updatedAt:
      new Date(
        row.updated_at,
      ),

    assignedAt:
      row.assigned_at === null
        ? null
        : new Date(
            row.assigned_at,
          ),

    startedAt:
      row.started_at === null
        ? null
        : new Date(
            row.started_at,
          ),

    completedAt:
      row.completed_at === null
        ? null
        : new Date(
            row.completed_at,
          ),

    failedAt:
      row.failed_at === null
        ? null
        : new Date(
            row.failed_at,
          ),
  };
}

/*
 * Complete a running task and persist its result.
 *
 * Task completion, artifact registration,
 * aggregation-task creation, and parent-job
 * reconciliation happen inside ONE PostgreSQL transaction.
 */
export async function completeTaskService(
  taskId: string,
  workerId: string,
  input: TaskResultInput,
): Promise<TaskRecord | null> {
  return withTransaction(async (client) => {
    /*
     * Complete the task.
     */
    const completedTask =
      await markTaskCompleted(
        taskId,
        workerId,
        input.result,
        client,
      );

    if (!completedTask) {
      return null;
    }

    /*
     * Persist any artifact produced by the task.
     */
    await registerTaskArtifact(
      input.result,
      client,
    );

    /*
     * Training tasks require an aggregation phase.
     *
     * IMPORTANT:
     *
     * This MUST happen BEFORE reconcileJobStatus().
     *
     * Otherwise the final training task could make the
     * parent job appear completed before the aggregation
     * task exists.
     */
    if (
      completedTask.taskType ===
      "training"
    ) {
      await ensureAggregationTask(
        completedTask.jobId,
        client,
      );
    }

    /*
     * Reconcile the parent job only after:
     *
     * 1. task completion
     * 2. artifact persistence
     * 3. aggregation-task creation
     *
     * have succeeded.
     */
    await reconcileJobStatus(
      completedTask.jobId,
      client,
    );

    return completedTask;
  });
}

/*
 * Mark a running task as failed.
 *
 * The repository decides whether the task becomes:
 *
 * retrying
 *    OR
 * failed
 *
 * based on attempt/max_attempts.
 */
export async function failTaskService(
  taskId: string,
  workerId: string,
  errorMessage: string,
): Promise<TaskRecord> {
  return withTransaction(async (client) => {
    const task = await markTaskFailed(
      taskId,
      workerId,
      errorMessage,
      client,
    );

    if (!task) {
      throw new Error(
        `Task ${taskId} could not be marked as failed.`,
      );
    }

    /*
     * Retryable failure:
     *
     * markTaskFailed() changes:
     *
     * running -> retrying
     *
     * We immediately move the task back to pending inside
     * the SAME transaction so another worker can claim it.
     */
    if (task.status === "retrying") {
      const requeuedTask = await requeueTask(
        task.taskId,
        client,
      );

      if (!requeuedTask) {
        throw new Error(
          `Task ${task.taskId} entered retrying state but could not be requeued.`,
        );
      }

      return requeuedTask;
    }

    /*
     * Permanent failure:
     *
     * running -> failed
     *
     * Reconcile the parent job because this task can now
     * determine the final job state.
     */
    if (task.status === "failed") {
      await reconcileJobStatus(
        task.jobId,
        client,
      );
    }

    return task;
  });
}
/*
 * Requeue a retrying task.
 */
export async function requeueTaskService(
  taskId: string,
): Promise<TaskRecord | null> {
  return requeueTask(taskId);
}