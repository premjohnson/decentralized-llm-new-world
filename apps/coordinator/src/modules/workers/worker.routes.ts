import type { FastifyInstance } from "fastify";

import { registerWorkerSchema } from "./worker.schema.js";

import {
  getWorker,
  getWorkers,
  heartbeatWorker,
  registerWorker,
} from "./worker.service.js";

interface WorkerParams {
  workerId: string;
}

export async function workerRoutes(
  app: FastifyInstance,
): Promise<void> {
  /*
   * Register worker
   *
   * POST /api/v1/workers/register
   */
  app.post(
    "/register",
    async (request, reply) => {
      const result = registerWorkerSchema.safeParse(
        request.body,
      );

      if (!result.success) {
        return reply.status(400).send({
          error: "VALIDATION_ERROR",
          message:
            "Invalid worker registration payload",
          details: result.error.flatten(),
        });
      }

      const worker = await registerWorker(result.data);

      return reply.status(201).send({
        data: worker,
      });
    },
  );

  /*
   * Get all workers
   *
   * GET /api/v1/workers
   */
  app.get(
    "/",
    async () => {
      const workers = await getWorkers();

      return {
        data: workers,
      };
    },
  );

  /*
   * Worker heartbeat
   *
   * POST /api/v1/workers/:workerId/heartbeat
   */
  app.post<{ Params: WorkerParams }>(
    "/:workerId/heartbeat",
    async (request, reply) => {
      const { workerId } = request.params;

      const worker = await heartbeatWorker(workerId);

      if (!worker) {
        return reply.status(404).send({
          error: "WORKER_NOT_FOUND",
          message: "Worker not found",
        });
      }

      return {
        data: {
          workerId: worker.workerId,
          status: worker.status,
          lastHeartbeatAt:
            worker.lastHeartbeatAt,
        },
      };
    },
  );

  /*
   * Get worker by ID
   *
   * GET /api/v1/workers/:workerId
   */
  app.get<{ Params: WorkerParams }>(
    "/:workerId",
    async (request, reply) => {
      const { workerId } = request.params;

      const worker = await getWorker(workerId);

      if (!worker) {
        return reply.status(404).send({
          error: "WORKER_NOT_FOUND",
          message: "Worker not found",
        });
      }

      return {
        data: worker,
      };
    },
  );
}