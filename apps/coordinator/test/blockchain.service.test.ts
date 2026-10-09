import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BlockchainClient } from "../src/modules/blockchain/blockchain.client.js";
import { BlockchainService } from "../src/modules/blockchain/blockchain.service.js";

describe("BlockchainService", () => {
  const mockClient = {
    registerTrainingJob: async (
      input: Parameters<BlockchainClient["registerTrainingJob"]>[0],
    ) => {
      return {
        signature: "test-register-signature",
        trainingJobAddress: "TestTrainingJobAddress",
      };
    },

    updateTrainingStatus: async (
      input: Parameters<BlockchainClient["updateTrainingStatus"]>[0],
    ) => {
      return {
        signature: "test-status-signature",
      };
    },

    recordTrainingRound: async (
      input: Parameters<BlockchainClient["recordTrainingRound"]>[0],
    ) => {
      return {
        signature: "test-round-signature",
      };
    },

    getTrainingJob: async (
      jobId: Parameters<BlockchainClient["getTrainingJob"]>[0],
    ) => {
      return null;
    },

    getBalance: async () => {
      return 1.5;
    },
  };

  const service = new BlockchainService(
    mockClient as unknown as BlockchainClient,
  );

  describe("registerTrainingJob", () => {
    it("registers a training job", async () => {
      const result = await service.registerTrainingJob({
        jobId: "test-job-001",
        modelName: "llama-3",
        modelVersion: "1.0.0",
        workerCount: 2,
        datasetHash: new Uint8Array(32),
      });

      assert.equal(result.signature, "test-register-signature");
      assert.equal(
        result.trainingJobAddress,
        "TestTrainingJobAddress",
      );
    });
  });

  describe("updateTrainingStatus", () => {
    it("updates training status", async () => {
      const result = await service.updateTrainingStatus(
        "test-job-001",
        "running",
      );

      assert.equal(result.signature, "test-status-signature");
    });
  });

  describe("recordTrainingRound", () => {
    it("records a training round", async () => {
      const result = await service.recordTrainingRound({
        jobId: "test-job-001",
        roundNumber: 1,
        checkpointHash: new Uint8Array(32),
        artifactHash: new Uint8Array(32),
        aggregationHash: new Uint8Array(32),
      });

      assert.equal(result.signature, "test-round-signature");
    });
  });

  describe("getTrainingJob", () => {
    it("reads a training job", async () => {
      const result = await service.getTrainingJob("test-job-001");

      assert.equal(result, null);
    });
  });

  describe("trainingJobExists", () => {
    it("returns false when the training job does not exist", async () => {
      const result = await service.trainingJobExists("test-job-001");

      assert.equal(result, false);
    });
  });

  describe("getAuthorityBalance", () => {
    it("returns the authority wallet balance", async () => {
      const result = await service.getAuthorityBalance();

      assert.equal(result, 1.5);
    });
  });

  describe("input validation", () => {
    it("rejects an empty job id", async () => {
      await assert.rejects(
        async () => {
          await service.registerTrainingJob({
            jobId: "",
            modelName: "llama-3",
            modelVersion: "1.0.0",
            workerCount: 2,
            datasetHash: new Uint8Array(32),
          });
        },
        {
          message: /jobId/i,
        },
      );
    });

    it("rejects an invalid round number", async () => {
      await assert.rejects(
        async () => {
          await service.recordTrainingRound({
            jobId: "test-job-001",
            roundNumber: 0,
            checkpointHash: new Uint8Array(32),
            artifactHash: new Uint8Array(32),
            aggregationHash: new Uint8Array(32),
          });
        },
        {
          message: /round/i,
        },
      );
    });

    it("rejects an invalid dataset hash", async () => {
      await assert.rejects(
        async () => {
          await service.registerTrainingJob({
            jobId: "test-job-001",
            modelName: "llama-3",
            modelVersion: "1.0.0",
            workerCount: 2,
            datasetHash: new Uint8Array(16),
          });
        },
        {
          message: /datasetHash/i,
        },
      );
    });
  });
});