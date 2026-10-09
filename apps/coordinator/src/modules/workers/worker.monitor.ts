import type { FastifyBaseLogger } from "fastify";

import { env } from "../../config/env.js";
import { markStaleWorkersOffline } from "./worker.service.js";

export interface WorkerHealthMonitor {
  stop: () => Promise<void>;
}

export function startWorkerHealthMonitor(
  logger: FastifyBaseLogger,
): WorkerHealthMonitor {
  const intervalMs =
    env.WORKER_HEALTH_CHECK_INTERVAL_SECONDS * 1000;

  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let runningCheck: Promise<void> | undefined;

  const scheduleNextCheck = (): void => {
    if (stopped) {
      return;
    }

    timer = setTimeout(() => {
      timer = undefined;

      runningCheck = runCheck().finally(() => {
        runningCheck = undefined;
        scheduleNextCheck();
      });
    }, intervalMs);
  };

  const runCheck = async (): Promise<void> => {
    try {
      const staleWorkers = await markStaleWorkersOffline(
        env.WORKER_HEARTBEAT_TIMEOUT_SECONDS,
      );

      for (const worker of staleWorkers) {
        logger.warn(
          {
            workerId: worker.workerId,
            lastHeartbeatAt: worker.lastHeartbeatAt,
          },
          "Worker marked offline because heartbeat timed out",
        );
      }
    } catch (error) {
      logger.error(
        error,
        "Failed to check for stale workers",
      );
    }
  };

  scheduleNextCheck();

  return {
    stop: async (): Promise<void> => {
      stopped = true;

      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }

      await runningCheck;
    },
  };
}
