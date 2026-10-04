import { z } from "zod";

/*
 * Task ID route parameter
 *
 * Used by:
 * GET /tasks/:taskId
 * POST /tasks/:taskId/requeue
 */
export const taskIdParamSchema = z.object({
  taskId: z.string().uuid(),
});

/*
 * Job ID route parameter
 *
 * Used by:
 * GET /jobs/:jobId/tasks
 */
export const jobIdParamSchema = z.object({
  jobId: z.string().uuid(),
});

/*
 * Task + Worker route parameters
 *
 * Used by:
 * POST /tasks/:taskId/running/:workerId
 * POST /tasks/:taskId/complete/:workerId
 * POST /tasks/:taskId/fail/:workerId
 */
export const workerTaskParamSchema = z.object({
  taskId: z.string().uuid(),
  workerId: z.string().min(1).max(100),
});

/*
 * Create task request body
 */
export const createTaskSchema = z.object({
  jobId: z.string().uuid(),

  taskType: z.enum([
    "training",
    "inference",
    "evaluation",
    "aggregation",
  ]),

  payload: z
    .record(z.string(), z.unknown())
    .default({}),

  maxAttempts: z
    .number()
    .int()
    .positive()
    .max(20)
    .default(3),
});

/*
 * Claim task request body
 */
export const claimTaskSchema = z.object({
  workerId: z.string().min(1).max(100),
});

/*
 * Task completion request body.
 *
 * Example:
 *
 * {
 *   "result": {
 *     "requestId": "abc-123",
 *     "model": "qwen2.5-1.5b-instruct-q4_k_m",
 *     "text": "Generated response..."
 *   }
 * }
 */
export const taskResultSchema = z.object({
  result: z.record(z.string(), z.unknown()),
});

/*
 * Task failure request body
 */
export const taskFailureSchema = z.object({
  errorMessage: z.string().min(1).max(5000),
});

/*
 * Inferred TypeScript types
 */
export type CreateTaskInput =
  z.infer<typeof createTaskSchema>;

export type ClaimTaskInput =
  z.infer<typeof claimTaskSchema>;

export type TaskResultInput =
  z.infer<typeof taskResultSchema>;

export type TaskFailureInput =
  z.infer<typeof taskFailureSchema>;