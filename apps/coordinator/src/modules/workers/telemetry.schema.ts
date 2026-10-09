import { z } from "zod";

const percentage = z.number().finite().min(0).max(100);

const nonNegativeInteger = z
  .number()
  .int()
  .nonnegative()
  .finite();

const positiveInteger = z
  .number()
  .int()
  .positive()
  .finite();

export const workerTelemetrySchema = z
  .object({
    cpuUsagePercent: percentage.nullable(),

    memoryUsedMb: nonNegativeInteger.nullable(),
    memoryTotalMb: positiveInteger.nullable(),

    gpuUtilizationPercent: percentage.nullable(),

    gpuMemoryUsedMb: nonNegativeInteger.nullable(),
    gpuMemoryTotalMb: positiveInteger.nullable(),

    collectedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    if (
      value.memoryUsedMb !== null &&
      value.memoryTotalMb !== null &&
      value.memoryUsedMb > value.memoryTotalMb
    ) {
      context.addIssue({
        code: "custom",
        path: ["memoryUsedMb"],
        message: "Used memory cannot exceed total memory",
      });
    }

    if (
      value.gpuMemoryUsedMb !== null &&
      value.gpuMemoryTotalMb !== null &&
      value.gpuMemoryUsedMb > value.gpuMemoryTotalMb
    ) {
      context.addIssue({
        code: "custom",
        path: ["gpuMemoryUsedMb"],
        message: "Used GPU memory cannot exceed total GPU memory",
      });
    }
  });

export type WorkerTelemetryInput = z.infer<
  typeof workerTelemetrySchema
>;
