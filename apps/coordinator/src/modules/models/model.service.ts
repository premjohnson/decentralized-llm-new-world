import type {
  RegisterModelInput,
  ModelStatus,
} from "./model.schema.js";

import {
  registerModel,
  findModelById,
  findReadyModelByName,
  findLatestModelByName,
  updateModelStatus,
} from "./model.repository.js";

const allowedStatusTransitions: Record<
  ModelStatus,
  readonly ModelStatus[]
> = {
  registered: ["ready", "failed"],
  ready: ["deprecated", "failed"],
  deprecated: [],
  failed: [],
};

export async function createModel(
  input: RegisterModelInput,
) {
  return registerModel(input);
}

export async function getModelById(
  modelId: string,
) {
  return findModelById(modelId);
}

export async function getReadyModel(
  modelName: string,
) {
  return findReadyModelByName(modelName);
}

export async function setModelStatus(
  modelId: string,
  status: ModelStatus,
) {
  const model = await findModelById(modelId);

  if (!model) {
    return null;
  }

  if (model.status === status) {
    throw new Error(
      `Model '${modelId}' is already in status '${status}'.`,
    );
  }

  const allowedTransitions =
    allowedStatusTransitions[model.status];

  if (!allowedTransitions.includes(status)) {
    throw new Error(
      `Invalid model status transition: '${model.status}' -> '${status}'.`,
    );
  }

  return updateModelStatus(
    modelId,
    status,
  );
}

export async function getLatestModelByName(
  modelName: string,
) {
  return findLatestModelByName(modelName);
}