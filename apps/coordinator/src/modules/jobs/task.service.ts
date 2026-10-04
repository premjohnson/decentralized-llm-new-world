import { randomUUID } from "node:crypto";

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

import { findJobById } from "./job.repository.js";

import type {
  CreateTaskInput,
  TaskResultInput,
  TaskFailureInput,
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
 *
 * Repository enforces:
 *
 * assigned + correct worker
 *        ↓
 *      running
 */
export async function markTaskRunningService(
  taskId: string,
  workerId: string,
): Promise<TaskRecord | null> {
  return markTaskRunning(taskId, workerId);
}

/*
 * Complete a running task and persist its result.
 *
 * Repository enforces:
 *
 * running + correct worker
 *        ↓
 *    completed
 *
 * The result is stored in PostgreSQL tasks.result.
 */
export async function completeTaskService(
  taskId: string,
  workerId: string,
  input: TaskResultInput,
): Promise<TaskRecord | null> {
  return markTaskCompleted(
    taskId,
    workerId,
    input.result,
  );
}

/*
 * Mark a running task as failed.
 *
 * Repository decides whether the task becomes:
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
  input: TaskFailureInput,
): Promise<TaskRecord | null> {
  return markTaskFailed(
    taskId,
    workerId,
    input.errorMessage,
  );
}

/*
 * Requeue a retrying task.
 */
export async function requeueTaskService(
  taskId: string,
): Promise<TaskRecord | null> {
  return requeueTask(taskId);
}