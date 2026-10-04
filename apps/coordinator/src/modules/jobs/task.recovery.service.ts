import {
  recoverTimedOutTasks,
  type RecoverTimedOutTasksResult,
} from "./task.recovery.repository.js";

export interface TaskRecoveryConfig {
  timeoutSeconds?: number;
}

/**
 * Recover tasks that have become stale because a worker
 * stopped progressing the task.
 */
export async function runTaskRecoveryCycle(
  config: TaskRecoveryConfig = {},
): Promise<RecoverTimedOutTasksResult> {
  const timeoutSeconds =
    config.timeoutSeconds ?? 300;

  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds <= 0
  ) {
    throw new Error(
      "Task timeout must be a positive integer",
    );
  }

  return recoverTimedOutTasks(timeoutSeconds);
}