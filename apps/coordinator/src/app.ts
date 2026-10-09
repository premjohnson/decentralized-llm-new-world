import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";

import { env } from "./config/env.js";
import { telemetryRoutes } from "./modules/workers/telemetry.routes.js";
import { workerRoutes } from "./modules/workers/worker.routes.js";
import { startWorkerHealthMonitor } from "./modules/workers/worker.monitor.js";
import { jobRoutes } from "./modules/jobs/job.routes.js";
import { taskRoutes } from "./modules/jobs/task.routes.js";
import { startTaskRecoveryWorker } from "./modules/jobs/task.recovery.worker.js";
import { startSchedulerWorker } from "./modules/scheduler/scheduler.worker.js";
import { artifactRoutes } from "./modules/artifacts/artifact.routes.js";
import { modelRoutes } from "./modules/models/model.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
    trustProxy: true,
  });

  await app.register(helmet);

  await app.register(cors, {
    origin:
      env.NODE_ENV === "production"
        ? false
        : ["http://localhost:5173", "http://127.0.0.1:5173"],
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "coordinator",
    environment: env.NODE_ENV,
  }));

  await app.register(workerRoutes, {
    prefix: "/api/v1/workers",
  });

  await app.register(jobRoutes, {
    prefix: "/api/v1",
  });

  await app.register(taskRoutes, {
    prefix: "/api/v1",
  });

  await app.register(artifactRoutes);

  await app.register(modelRoutes, {
    prefix: "/api/v1",
  });

  await app.register(telemetryRoutes, {
    prefix: "/api/v1/workers",
  });

  let healthMonitor:
    | ReturnType<typeof startWorkerHealthMonitor>
    | undefined;

  let schedulerWorker: NodeJS.Timeout | undefined;
  let taskRecoveryWorker: NodeJS.Timeout | undefined;

  /*
   * Background workers must not run during tests.
   *
   * Tests directly control PostgreSQL state,
   * so background workers would introduce races
   * and make integration tests nondeterministic.
   */
  if (env.NODE_ENV !== "test") {
    healthMonitor = startWorkerHealthMonitor(app.log);
    schedulerWorker = startSchedulerWorker(app.log);
    taskRecoveryWorker = startTaskRecoveryWorker(app.log);
  }

  app.addHook("onClose", async () => {
    if (healthMonitor) {
      await healthMonitor.stop();
      app.log.info("Worker health monitor stopped");
    }

    if (schedulerWorker) {
      clearInterval(schedulerWorker);
      app.log.info("Scheduler worker stopped");
    }

    if (taskRecoveryWorker) {
      clearInterval(taskRecoveryWorker);
      app.log.info("Task recovery worker stopped");
    }
  });

  return app;
}
