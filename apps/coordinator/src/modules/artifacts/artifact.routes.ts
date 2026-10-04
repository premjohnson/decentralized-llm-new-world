import type { FastifyInstance } from "fastify";
import {
  artifactIdParamSchema,
  createArtifactSchema,
  jobArtifactsParamSchema,
  taskArtifactsParamSchema,
} from "./artifact.schema.js";
import {
  getArtifactById,
  getArtifactsByJobId,
  getArtifactsByTaskId,
  registerArtifact,
} from "./artifact.service.js";

export async function artifactRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/artifacts", async (request, reply) => {
    const parsed = createArtifactSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid artifact payload",
        details: parsed.error.flatten(),
      });
    }

    try {
      const artifact = await registerArtifact(parsed.data);

      return reply.code(201).send({
        artifact,
      });
    } catch (error) {
      request.log.error(
        { error },
        "Failed to register artifact",
      );

      return reply.code(500).send({
        error: "Failed to register artifact",
      });
    }
  });

  app.get(
    "/artifacts/:artifactId",
    async (request, reply) => {
      const parsed = artifactIdParamSchema.safeParse(
        request.params,
      );

      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid artifact ID",
          details: parsed.error.flatten(),
        });
      }

      const artifact = await getArtifactById(
        parsed.data.artifactId,
      );

      if (!artifact) {
        return reply.code(404).send({
          error: "Artifact not found",
        });
      }

      return reply.send({
        artifact,
      });
    },
  );

  app.get(
    "/jobs/:jobId/artifacts",
    async (request, reply) => {
      const parsed = jobArtifactsParamSchema.safeParse(
        request.params,
      );

      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid job ID",
          details: parsed.error.flatten(),
        });
      }

      const artifacts = await getArtifactsByJobId(
        parsed.data.jobId,
      );

      return reply.send({
        artifacts,
      });
    },
  );

  app.get(
    "/tasks/:taskId/artifacts",
    async (request, reply) => {
      const parsed = taskArtifactsParamSchema.safeParse(
        request.params,
      );

      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid task ID",
          details: parsed.error.flatten(),
        });
      }

      const artifacts = await getArtifactsByTaskId(
        parsed.data.taskId,
      );

      return reply.send({
        artifacts,
      });
    },
  );
}