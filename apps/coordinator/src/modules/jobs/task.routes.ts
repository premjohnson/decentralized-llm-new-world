import type { FastifyInstance } from "fastify";

import {
  createTaskService,
  getTaskByIdService,
  getTasksByJobIdService,
  claimNextTaskService,
  markTaskRunningService,
  completeTaskService,
  failTaskService,
  requeueTaskService,
} from "./task.service.js";

import {
  createTaskSchema,
  taskIdParamSchema,
  jobIdParamSchema,
  workerTaskParamSchema,
  claimTaskSchema,
  taskResultSchema,
  taskFailureSchema,
} from "./task.schema.js";

export async function taskRoutes(
  app: FastifyInstance,
): Promise<void> {
  /*
   * =========================================================
   * CREATE TASK
   * =========================================================
   *
   * POST /api/v1/tasks
   */
  app.post("/tasks", async (request, reply) => {
    const parsed = createTaskSchema.safeParse(
      request.body,
    );

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid task payload",
        details: parsed.error.flatten(),
      });
    }

    try {
      const task = await createTaskService(
        parsed.data,
      );

      return reply.status(201).send(task);
    } catch (error) {
      /*
       * Job does not exist.
       */
      if (
        error instanceof Error &&
        error.message === "Job not found"
      ) {
        return reply.status(404).send({
          error: "Job not found",
        });
      }

      /*
       * Job is already terminal.
       */
      if (
        error instanceof Error &&
        error.message.startsWith(
          "Cannot create task for job",
        )
      ) {
        return reply.status(409).send({
          error: error.message,
        });
      }

      throw error;
    }
  });

  /*
   * =========================================================
   * GET TASK
   * =========================================================
   *
   * GET /api/v1/tasks/:taskId
   */
  app.get(
    "/tasks/:taskId",
    async (request, reply) => {
      const parsed = taskIdParamSchema.safeParse(
        request.params,
      );

      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid task ID",
          details: parsed.error.flatten(),
        });
      }

      const task = await getTaskByIdService(
        parsed.data.taskId,
      );

      if (!task) {
        return reply.status(404).send({
          error: "Task not found",
        });
      }

      return reply.status(200).send(task);
    },
  );

  /*
   * =========================================================
   * GET TASKS FOR JOB
   * =========================================================
   *
   * GET /api/v1/jobs/:jobId/tasks
   */
  app.get(
    "/jobs/:jobId/tasks",
    async (request, reply) => {
      const parsed = jobIdParamSchema.safeParse(
        request.params,
      );

      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid job ID",
          details: parsed.error.flatten(),
        });
      }

      try {
        const tasks =
          await getTasksByJobIdService(
            parsed.data.jobId,
          );

        return reply.status(200).send(tasks);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Job not found"
        ) {
          return reply.status(404).send({
            error: "Job not found",
          });
        }

        throw error;
      }
    },
  );

  /*
   * =========================================================
   * CLAIM NEXT TASK
   * =========================================================
   *
   * POST /api/v1/tasks/claim
   *
   * Body:
   * {
   *   "workerId": "worker-01"
   * }
   */
  app.post(
    "/tasks/claim",
    async (request, reply) => {
      const parsed = claimTaskSchema.safeParse(
        request.body,
      );

      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid claim payload",
          details: parsed.error.flatten(),
        });
      }

      const task =
        await claimNextTaskService(
          parsed.data.workerId,
        );

      /*
       * No pending tasks.
       */
      if (!task) {
        return reply.status(204).send();
      }

      return reply.status(200).send(task);
    },
  );

  /*
   * =========================================================
   * MARK TASK RUNNING
   * =========================================================
   *
   * POST /api/v1/tasks/:taskId/running/:workerId
   */
  app.post(
    "/tasks/:taskId/running/:workerId",
    async (request, reply) => {
      const parsed =
        workerTaskParamSchema.safeParse(
          request.params,
        );

      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid task or worker ID",
          details: parsed.error.flatten(),
        });
      }

      const task =
        await markTaskRunningService(
          parsed.data.taskId,
          parsed.data.workerId,
        );

      if (!task) {
        return reply.status(409).send({
          error:
            "Task cannot be moved to running state",
        });
      }

      return reply.status(200).send(task);
    },
  );

  /*
   * =========================================================
   * COMPLETE TASK
   * =========================================================
   *
   * POST /api/v1/tasks/:taskId/complete/:workerId
   *
   * Body:
   * {
   *   "result": {
   *     "requestId": "abc-123",
   *     "model": "qwen2.5-1.5b-instruct-q4_k_m",
   *     "text": "Generated response..."
   *   }
   * }
   */
  app.post(
    "/tasks/:taskId/complete/:workerId",
    async (request, reply) => {
      const params =
        workerTaskParamSchema.safeParse(
          request.params,
        );

      if (!params.success) {
        return reply.status(400).send({
          error: "Invalid task or worker ID",
          details: params.error.flatten(),
        });
      }

      const body =
        taskResultSchema.safeParse(
          request.body,
        );

      if (!body.success) {
        return reply.status(400).send({
          error: "Invalid task result payload",
          details: body.error.flatten(),
        });
      }

      const task =
        await completeTaskService(
          params.data.taskId,
          params.data.workerId,
          body.data,
        );

      if (!task) {
        return reply.status(409).send({
          error:
            "Task cannot be completed from its current state",
        });
      }

      return reply.status(200).send(task);
    },
  );

  /*
   * =========================================================
   * FAIL TASK
   * =========================================================
   *
   * POST /api/v1/tasks/:taskId/fail/:workerId
   *
   * Body:
   * {
   *   "errorMessage": "Training process crashed"
   * }
   */
  app.post(
    "/tasks/:taskId/fail/:workerId",
    async (request, reply) => {
      const params =
        workerTaskParamSchema.safeParse(
          request.params,
        );

      if (!params.success) {
        return reply.status(400).send({
          error: "Invalid task or worker ID",
          details: params.error.flatten(),
        });
      }

      const body =
        taskFailureSchema.safeParse(
          request.body,
        );

      if (!body.success) {
        return reply.status(400).send({
          error: "Invalid failure payload",
          details: body.error.flatten(),
        });
      }

      const task =
        await failTaskService(
          params.data.taskId,
          params.data.workerId,
          body.data,
        );

      if (!task) {
        return reply.status(409).send({
          error:
            "Task cannot be failed from its current state",
        });
      }

      return reply.status(200).send(task);
    },
  );

  /*
   * =========================================================
   * REQUEUE TASK
   * =========================================================
   *
   * POST /api/v1/tasks/:taskId/requeue
   */
  app.post(
    "/tasks/:taskId/requeue",
    async (request, reply) => {
      const parsed = taskIdParamSchema.safeParse(
        request.params,
      );

      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid task ID",
          details: parsed.error.flatten(),
        });
      }

      const task =
        await requeueTaskService(
          parsed.data.taskId,
        );

      if (!task) {
        return reply.status(409).send({
          error:
            "Task cannot be requeued from its current state",
        });
      }

      return reply.status(200).send(task);
    },
  );
}