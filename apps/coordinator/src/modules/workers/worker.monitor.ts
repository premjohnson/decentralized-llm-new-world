import type { FastifyBaseLogger } from "fastify";

import { env } from "../../config/env.js";
import { markStaleWorkersOffline } from "./worker.service.js";

export function startWorkerHealthMonitor(
  logger: FastifyBaseLogger,
): NodeJS.Timeout {
  const intervalMs =
    env.WORKER_HEALTH_CHECK_INTERVAL_SECONDS * 1000;

  const timer = setInterval(async () => {
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
  }, intervalMs);

  return timer;
}