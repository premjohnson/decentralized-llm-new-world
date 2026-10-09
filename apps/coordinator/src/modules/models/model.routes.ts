import type { FastifyInstance } from "fastify";

import {
  modelIdParamSchema,
  modelNameParamSchema,
  registerModelSchema,
  updateModelStatusSchema,
} from "./model.schema.js";

import {
  createModel,
  getModelById,
  getReadyModel,
  setModelStatus,
} from "./model.service.js";

export async function modelRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * Register a model
   */
  app.post("/models", async (request, reply) => {
    const parsed = registerModelSchema.safeParse(
      request.body,
    );

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid model payload",
        details: parsed.error.flatten(),
      });
    }

    try {
      const model = await createModel(parsed.data);

      return reply.code(201).send({
        model,
      });
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(409).send({
          error: error.message,
        });
      }

      request.log.error(
        { error },
        "Failed to register model",
      );

      return reply.code(500).send({
        error: "Failed to register model",
      });
    }
  });

  /**
   * Get model by ID
   */
  app.get(
    "/models/:modelId",
    async (request, reply) => {
      const parsed = modelIdParamSchema.safeParse(
        request.params,
      );

      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid model ID",
          details: parsed.error.flatten(),
        });
      }

      const model = await getModelById(
        parsed.data.modelId,
      );

      if (!model) {
        return reply.code(404).send({
          error: "Model not found",
        });
      }

      return reply.send({
        model,
      });
    },
  );

  /**
   * Get latest ready model by model name
   */
  app.get(
    "/models/:modelName/ready",
    async (request, reply) => {
      const parsed = modelNameParamSchema.safeParse(
        request.params,
      );

      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid model name",
          details: parsed.error.flatten(),
        });
      }

      const model = await getReadyModel(
        parsed.data.modelName,
      );

      if (!model) {
        return reply.code(404).send({
          error: "Ready model not found",
        });
      }

      return reply.send({
        model,
      });
    },
  );

  /**
   * Update model status
   */
  app.patch(
    "/models/:modelId/status",
    async (request, reply) => {
      const params = modelIdParamSchema.safeParse(
        request.params,
      );

      if (!params.success) {
        return reply.code(400).send({
          error: "Invalid model ID",
          details: params.error.flatten(),
        });
      }

      const body = updateModelStatusSchema.safeParse(
        request.body,
      );

      if (!body.success) {
        return reply.code(400).send({
          error: "Invalid model status",
          details: body.error.flatten(),
        });
      }

      try {
        const model = await setModelStatus(
          params.data.modelId,
          body.data.status,
        );

        if (!model) {
          return reply.code(404).send({
            error: "Model not found",
          });
        }

        return reply.send({
          model,
        });
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(409).send({
            error: error.message,
          });
        }

        request.log.error(
          { error },
          "Failed to update model status",
        );

        return reply.code(500).send({
          error: "Failed to update model status",
        });
      }
    },
  );
}