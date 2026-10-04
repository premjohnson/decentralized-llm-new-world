import type { FastifyBaseLogger } from "fastify";

import {
  acquireLock,
  releaseLock,
  type RedisLock,
} from "../../redis/lock.js";

import { runSchedulerCycle } from "./scheduler.service.js";

const DEFAULT_INTERVAL_MS = 5_000;

const SCHEDULER_LOCK_KEY = "scheduler:global-lock";
const SCHEDULER_LOCK_TTL_SECONDS = 10;

export function startSchedulerWorker(
  logger: FastifyBaseLogger,
  intervalMs = DEFAULT_INTERVAL_MS,
): NodeJS.Timeout {
  if (
    !Number.isInteger(intervalMs) ||
    intervalMs <= 0
  ) {
    throw new Error(
      "Scheduler interval must be a positive integer",
    );
  }

  let running = false;

  const run = async (): Promise<void> => {
    /*
     * Local protection.
     *
     * Prevent overlapping scheduler cycles inside
     * the same Coordinator process.
     */
    if (running) {
      logger.warn(
        "Scheduler cycle skipped because the previous cycle is still running",
      );

      return;
    }

    running = true;

    let lock: RedisLock | null = null;

    try {
      /*
       * Distributed protection.
       *
       * Only one Coordinator instance can own this
       * scheduler lock at a time.
       */
      lock = await acquireLock(
        SCHEDULER_LOCK_KEY,
        SCHEDULER_LOCK_TTL_SECONDS,
      );

      if (lock === null) {
        logger.debug(
          "Scheduler cycle skipped because another Coordinator holds the distributed lock",
        );

        return;
      }

      const result = await runSchedulerCycle();

      if (
        result.jobsProcessed > 0 ||
        result.jobsStarted > 0 ||
        result.jobsWaitingForTasks > 0
      ) {
        logger.info(
          {
            jobsProcessed: result.jobsProcessed,
            jobsStarted: result.jobsStarted,
            jobsWaitingForTasks:
              result.jobsWaitingForTasks,
          },
          "Scheduler cycle completed",
        );
      }
    } catch (error) {
      logger.error(
        {
          error,
        },
        "Scheduler cycle failed",
      );
    } finally {
      /*
       * Release only the lock owned by this
       * Coordinator instance.
       */
      if (lock !== null) {
        try {
          const released =
            await releaseLock(lock);

          if (!released) {
            logger.warn(
              "Scheduler lock was not released because ownership had changed or the lock expired",
            );
          }
        } catch (error) {
          logger.error(
            {
              error,
            },
            "Failed to release scheduler distributed lock",
          );
        }
      }

      running = false;
    }
  };

  /*
   * Run immediately when the scheduler starts.
   */
  void run();

  /*
   * Continue periodically.
   */
  const timer = setInterval(
    () => {
      void run();
    },
    intervalMs,
  );

  logger.info(
    {
      intervalMs,
      lockKey: SCHEDULER_LOCK_KEY,
      lockTtlSeconds:
        SCHEDULER_LOCK_TTL_SECONDS,
    },
    "Scheduler worker started",
  );

  return timer;
}