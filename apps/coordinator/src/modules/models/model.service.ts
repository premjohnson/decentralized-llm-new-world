import type {
  RegisterModelInput,
  ModelStatus,
} from "./model.schema.js";

import {
  registerModel,
  findModelById,
  findReadyModelByName,
  updateModelStatus,
} from "./model.repository.js";

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
  return updateModelStatus(
    modelId,
    status,
  );
}
