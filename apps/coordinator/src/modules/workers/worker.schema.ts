import { z } from "zod";

export const workerCapabilitiesSchema = z.object({
  cpuCores: z.number().int().positive(),

  memoryMb: z.number().int().positive(),

  gpu: z.boolean(),

  gpuModel: z.string().trim().min(1).optional(),

  vramMb: z.number().int().positive().optional(),
});

export const registerWorkerSchema = z.object({
  workerId: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "workerId may contain only letters, numbers, underscores and hyphens",
    ),

  hostname: z
    .string()
    .trim()
    .min(1)
    .max(255),

  capabilities: workerCapabilitiesSchema,
});

export type RegisterWorkerInput = z.infer<
  typeof registerWorkerSchema
>;