import type { CreateArtifactInput } from "./artifact.schema.js";
import {
  createArtifact,
  findArtifactById,
  findArtifactsByJobId,
  findArtifactsByTaskId,
} from "./artifact.repository.js";

export async function registerArtifact(
  input: CreateArtifactInput,
) {
  return createArtifact(input);
}

export async function getArtifactById(
  artifactId: string,
) {
  return findArtifactById(artifactId);
}

export async function getArtifactsByJobId(
  jobId: string,
) {
  return findArtifactsByJobId(jobId);
}

export async function getArtifactsByTaskId(
  taskId: string,
) {
  return findArtifactsByTaskId(taskId);
}