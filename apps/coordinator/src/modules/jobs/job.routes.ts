import type { FastifyInstance } from "fastify";

import {
  createJobService,
  getAllJobsService,
  getJobByIdService,
} from "./job.service.js";
import {
  createJobSchema,
  jobIdParamSchema,
} from "./job.schema.js";

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.post("/jobs", async (request, reply) => {
    const parsed = createJobSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid job payload",
        details: parsed.error.flatten(),
      });
    }

    const job = await createJobService(parsed.data);

    return reply.status(201).send(job);
  });

  app.get("/jobs", async (_request, reply) => {
    const jobs = await getAllJobsService();

    return reply.status(200).send(jobs);
  });

  app.get("/jobs/:jobId", async (request, reply) => {
    const parsed = jobIdParamSchema.safeParse(request.params);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid job ID",
        details: parsed.error.flatten(),
      });
    }

    const job = await getJobByIdService(parsed.data.jobId);

    if (!job) {
      return reply.status(404).send({
        error: "Job not found",
      });
    }

    return reply.status(200).send(job);
  });
}