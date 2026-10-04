import type { FastifyBaseLogger } from "fastify";

import {
  acquireLock,
  releaseLock,
  type RedisLock,
} from "../../redis/lock.js";

import { env } from "../../config/env.js";

import {
  runTaskRecoveryCycle,
  type TaskRecoveryConfig,
} from "./task.recovery.service.js";

const TASK_RECOVERY_LOCK_KEY =
  "tasks:recovery:global-lock";

const TASK_RECOVERY_LOCK_TTL_SECONDS = 10;

export interface TaskRecoveryWorkerResult {
  acquiredLock: boolean;
  recoveredTasks: number;
  requeuedCount: number;
  failedCount: number;
}

/**
 * Executes one task-recovery cycle.
 *
 * The Redis lock makes this safe when multiple Coordinator
 * instances are running simultaneously.
 */
export async function runTaskRecoveryWorkerCycle(
  logger: FastifyBaseLogger,
  config: TaskRecoveryConfig = {},
): Promise<TaskRecoveryWorkerResult> {
  let lock: RedisLock | null = null;

  try {
    lock = await acquireLock(
      TASK_RECOVERY_LOCK_KEY,
      TASK_RECOVERY_LOCK_TTL_SECONDS,
    );

    if (lock === null) {
      logger.debug(
        "Task recovery cycle skipped because another Coordinator holds the distributed lock",
      );

      return {
        acquiredLock: false,
        recoveredTasks: 0,
        requeuedCount: 0,
        failedCount: 0,
      };
    }

    const result =
      await runTaskRecoveryCycle(config);

    if (
      result.requeuedCount > 0 ||
      result.failedCount > 0
    ) {
      logger.info(
        {
          recoveredTasks:
            result.recoveredTasks.length,
          requeuedCount:
            result.requeuedCount,
          failedCount:
            result.failedCount,
          timeoutSeconds:
            config.timeoutSeconds ??
            env.TASK_RECOVERY_TIMEOUT_SECONDS,
        },
        "Task recovery cycle completed",
      );
    }

    return {
      acquiredLock: true,
      recoveredTasks:
        result.recoveredTasks.length,
      requeuedCount:
        result.requeuedCount,
      failedCount:
        result.failedCount,
    };
  } catch (error) {
    logger.error(
      { error },
      "Task recovery cycle failed",
    );

    throw error;
  } finally {
    if (lock !== null) {
      try {
        const released =
          await releaseLock(lock);

        if (!released) {
          logger.warn(
            "Task recovery lock was not released because ownership had changed or the lock expired",
          );
        }
      } catch (error) {
        logger.error(
          { error },
          "Failed to release task recovery distributed lock",
        );

        throw error;
      }
    }
  }
}

/**
 * Starts the background task-recovery loop.
 */
export function startTaskRecoveryWorker(
  logger: FastifyBaseLogger,
  intervalMs =
    env.TASK_RECOVERY_INTERVAL_SECONDS * 1000,
): NodeJS.Timeout {
  if (
    !Number.isInteger(intervalMs) ||
    intervalMs <= 0
  ) {
    throw new Error(
      "Task recovery interval must be a positive integer",
    );
  }

  let running = false;

  const run = async (): Promise<void> => {
    if (running) {
      logger.warn(
        "Task recovery cycle skipped because the previous cycle is still running",
      );

      return;
    }

    running = true;

    try {
      await runTaskRecoveryWorkerCycle(
        logger,
        {
          timeoutSeconds:
            env.TASK_RECOVERY_TIMEOUT_SECONDS,
        },
      );
    } catch {
      /*
       * runTaskRecoveryWorkerCycle already logs the
       * underlying error. The background worker must
       * continue running after a failed cycle.
       */
    } finally {
      running = false;
    }
  };

  /*
   * Run immediately after Coordinator startup so stale
   * tasks are recovered without waiting for the first interval.
   */
  void run();

  const timer = setInterval(
    () => {
      void run();
    },
    intervalMs,
  );

  logger.info(
    {
      intervalMs,
      timeoutSeconds:
        env.TASK_RECOVERY_TIMEOUT_SECONDS,
      lockKey:
        TASK_RECOVERY_LOCK_KEY,
      lockTtlSeconds:
        TASK_RECOVERY_LOCK_TTL_SECONDS,
    },
    "Task recovery worker started",
  );

  return timer;
}