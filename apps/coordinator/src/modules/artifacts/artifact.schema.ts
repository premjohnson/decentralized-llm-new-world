import { z } from "zod";

export const artifactTypeSchema = z.enum([
  "lora_adapter",
  "model_checkpoint",
  "evaluation_result",
]);

export const createArtifactSchema = z.object({
  taskId: z.string().uuid(),
  jobId: z.string().uuid(),

  workerId: z
    .string()
    .min(1)
    .max(100)
    .nullable()
    .optional(),

  artifactType: artifactTypeSchema,

  storageUri: z.string().min(1),

  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/),

  sizeBytes: z
    .number()
    .int()
    .nonnegative(),

  sampleCount: z
    .number()
    .int()
    .positive()
    .optional(),

  modelName: z
    .string()
    .min(1)
    .max(255),

  format: z
    .string()
    .min(1)
    .max(50),
});

export const artifactIdParamSchema = z.object({
  artifactId: z.string().uuid(),
});

export const jobArtifactsParamSchema = z.object({
  jobId: z.string().uuid(),
});

export const taskArtifactsParamSchema = z.object({
  taskId: z.string().uuid(),
});

export type CreateArtifactInput =
  z.infer<typeof createArtifactSchema>;

export type ArtifactType =
  z.infer<typeof artifactTypeSchema>;