import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getWorker } from "./worker.service.js";
import { workerTelemetrySchema } from "./telemetry.schema.js";
import {
  getAllWorkerTelemetry,
  getWorkerTelemetry,
  upsertWorkerTelemetry,
} from "./telemetry.repository.js";

const paramsSchema = z.object({
  workerId: z.string().min(3).max(100).regex(/^[a-zA-Z0-9_-]+$/),
});

export async function telemetryRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post<{ Params: { workerId: string } }>(
    "/:workerId/telemetry",
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = workerTelemetrySchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.status(400).send({
          error: "VALIDATION_ERROR",
          message: "Invalid worker telemetry payload",
          details: {
            params: params.success ? undefined : params.error.flatten(),
            body: body.success ? undefined : body.error.flatten(),
          },
        });
      }

      try {
        const telemetry = await upsertWorkerTelemetry(
          params.data.workerId,
          body.data,
        );

        return { data: telemetry };
      } catch (error) {
        if (error instanceof Error && error.message === "WORKER_NOT_FOUND") {
          return reply.status(404).send({
            error: "WORKER_NOT_FOUND",
            message: "Worker must be registered before submitting telemetry",
          });
        }

        if (error instanceof Error && error.message === "STALE_TELEMETRY") {
          return reply.status(409).send({
            error: "STALE_TELEMETRY",
            message: "A newer telemetry snapshot already exists",
          });
        }

        throw error;
      }
    },
  );

  app.get("/telemetry", async () => ({
    data: await getAllWorkerTelemetry(),
  }));

  app.get<{ Params: { workerId: string } }>(
    "/:workerId/telemetry",
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          error: "VALIDATION_ERROR",
          details: params.error.flatten(),
        });
      }

      const worker = await getWorker(params.data.workerId);

      if (!worker) {
        return reply.status(404).send({
          error: "WORKER_NOT_FOUND",
          message: "Worker not found",
        });
      }

      const telemetry = await getWorkerTelemetry(params.data.workerId);

      if (!telemetry) {
        return reply.status(404).send({
          error: "TELEMETRY_NOT_FOUND",
          message: "No telemetry has been reported by this worker",
        });
      }

      return { data: telemetry };
    },
  );
}
