import { createHash } from "node:crypto";

export function hashJobId(jobId: string): Uint8Array {
  if (!jobId || jobId.trim().length === 0) {
    throw new Error("jobId must not be empty");
  }

  return new Uint8Array(
    createHash("sha256")
      .update(jobId, "utf8")
      .digest(),
  );
}