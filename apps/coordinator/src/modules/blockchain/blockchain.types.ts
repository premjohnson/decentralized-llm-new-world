export type BlockchainTrainingStatus =
  | "registered"
  | "running"
  | "completed"
  | "failed";

export interface RegisterTrainingJobInput {
  jobId: string;
  modelName: string;
  modelVersion: string;
  workerCount: number;
  datasetHash: Uint8Array;
}

export interface RecordTrainingRoundInput {
  jobId: string;
  roundNumber: number;
  checkpointHash: Uint8Array;
  artifactHash: Uint8Array;
  aggregationHash: Uint8Array;
}

export interface UpdateTrainingStatusInput {
  jobId: string;
  status: BlockchainTrainingStatus;
}

export interface BlockchainTransactionResult {
  signature: string;
  trainingJobAddress?: string;
  trainingRoundAddress?: string;
}