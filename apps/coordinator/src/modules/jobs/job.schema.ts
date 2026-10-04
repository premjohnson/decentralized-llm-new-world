import { z } from "zod";

const baseConfigSchema = z.object({
  workers: z.number().int().min(1).max(100).optional(),
});

const inferenceConfigSchema = baseConfigSchema.extend({
  prompt: z.string().min(1).max(100_000),
  maxTokens: z.number().int().positive().default(128),
  temperature: z.number().min(0).default(0.7),
});

const trainingConfigSchema = baseConfigSchema.extend({
  epochs: z.number().int().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  learningRate: z.number().positive().optional(),
});

const evaluationConfigSchema = baseConfigSchema.extend({
  metrics: z.array(z.string().min(1)).min(1).optional(),
});

export const createJobSchema = z
  .object({
    name: z.string().min(1).max(255),

    jobType: z.enum(["training", "inference", "evaluation"]),

    modelName: z.string().min(1).max(255),

    datasetName: z.string().min(1).max(255).optional(),

    config: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((job, ctx) => {
    let result;

    switch (job.jobType) {
      case "inference":
        result = inferenceConfigSchema.safeParse(job.config);
        break;

      case "training":
        result = trainingConfigSchema.safeParse(job.config);
        break;

      case "evaluation":
        result = evaluationConfigSchema.safeParse(job.config);
        break;
    }

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["config", ...issue.path],
        });
      }
    }
  });

export const jobIdParamSchema = z.object({
  jobId: z.string().uuid(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;