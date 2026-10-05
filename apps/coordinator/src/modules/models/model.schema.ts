import { z } from "zod";

export const modelStatusSchema = z.enum([
  "registered",
  "ready",
  "deprecated",
  "failed",
]);

export const registerModelSchema = z.object({
  modelName: z
    .string()
    .min(1)
    .max(255),

  version: z
    .string()
    .min(1)
    .max(100),

  artifactId: z
    .string()
    .uuid(),

  baseModelName: z
    .string()
    .min(1)
    .max(255)
    .nullable()
    .optional(),

  metadata: z
    .record(z.string(), z.unknown())
    .default({}),
});

export const updateModelStatusSchema = z.object({
  status: modelStatusSchema,
});

export const modelIdParamSchema = z.object({
  modelId: z.string().uuid(),
});

export const modelNameParamSchema = z.object({
  modelName: z
    .string()
    .min(1)
    .max(255),
});

export type RegisterModelInput =
  z.infer<typeof registerModelSchema>;

export type UpdateModelStatusInput =
  z.infer<typeof updateModelStatusSchema>;

export type ModelStatus =
  z.infer<typeof modelStatusSchema>;