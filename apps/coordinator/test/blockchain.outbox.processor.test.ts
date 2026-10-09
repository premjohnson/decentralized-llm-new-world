import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { db } from "../src/db/pool.js";
import { BlockchainOutboxProcessor } from "../src/modules/blockchain/blockchain.outbox.processor.js";
import {
  createBlockchainOutboxEvent,
  findBlockchainOutboxByIdempotencyKey,
} from "../src/modules/blockchain/blockchain.outbox.repository.js";

type FakeTrainingJob = {
  status: unknown;
  roundCount: unknown;
};

class FakeBlockchainService {
  readonly registeredJobs: string[] = [];
  readonly updatedStatuses: Array<{
    jobId: string;
    status: string;
  }> = [];

  readonly recordedRounds: Array<{
    jobId: string;
    roundNumber: number;
  }> = [];

  readonly existingJobs =
    new Map<string, FakeTrainingJob>();

  async getTrainingJob(
    jobId: string,
  ): Promise<FakeTrainingJob | null> {
    return (
      this.existingJobs.get(jobId) ??
      null
    );
  }

  async registerTrainingJob(
    input: {
      jobId: string;
      modelName: string;
      modelVersion: string;
      workerCount: number;
      datasetHash: Uint8Array;
    },
  ): Promise<{
    signature: string;
    trainingJobAddress: string;
  }> {
    this.registeredJobs.push(
      input.jobId,
    );

    this.existingJobs.set(
      input.jobId,
      {
        status: {
          registered: {},
        },
        roundCount: 0,
      },
    );

    return {
      signature:
        `fake-register-${input.jobId}`,
      trainingJobAddress:
        `fake-pda-${input.jobId}`,
    };
  }

  async updateTrainingStatus(
    jobId: string,
    status: string,
  ): Promise<{
    signature: string;
    trainingJobAddress: string;
  }> {
    this.updatedStatuses.push({
      jobId,
      status,
    });

    const job =
      this.existingJobs.get(jobId);

    if (!job) {
      throw new Error(
        `Unknown fake training job: ${jobId}`,
      );
    }

    job.status = {
      [status]: {},
    };

    return {
      signature:
        `fake-status-${jobId}-${status}`,
      trainingJobAddress:
        `fake-pda-${jobId}`,
    };
  }

  async recordTrainingRound(
    input: {
      jobId: string;
      roundNumber: number;
      checkpointHash: Uint8Array;
      artifactHash: Uint8Array;
      aggregationHash: Uint8Array;
    },
  ): Promise<{
    signature: string;
    trainingJobAddress: string;
    trainingRoundAddress: string;
  }> {
    this.recordedRounds.push({
      jobId: input.jobId,
      roundNumber:
        input.roundNumber,
    });

    const job =
      this.existingJobs.get(
        input.jobId,
      );

    if (!job) {
      throw new Error(
        `Unknown fake training job: ${input.jobId}`,
      );
    }

    job.roundCount =
      input.roundNumber;

    return {
      signature:
        `fake-round-${input.jobId}-${input.roundNumber}`,
      trainingJobAddress:
        `fake-pda-${input.jobId}`,
      trainingRoundAddress:
        `fake-round-pda-${input.jobId}-${input.roundNumber}`,
    };
  }
}

const HASH =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function createDatabaseJob(): Promise<string> {
  const jobId = randomUUID();

  await db.query(
    `
      INSERT INTO jobs (
        job_id,
        name,
        job_type,
        model_name,
        dataset_name,
        config
      )
      VALUES (
        $1,
        $2,
        'training',
        $3,
        $4,
        $5::jsonb
      )
    `,
    [
      jobId,
      `processor-test-${jobId}`,
      "test-model",
      "test-dataset",
      JSON.stringify({
        workers: 1,
      }),
    ],
  );

  return jobId;
}

async function cleanupJob(jobId: string): Promise<void> {
  await db.query(
    `
      DELETE FROM blockchain_outbox
      WHERE job_id = $1
    `,
    [jobId],
  );

  await db.query(
    `
      DELETE FROM jobs
      WHERE job_id = $1
    `,
    [jobId],
  );
}

test.after(async () => {
  await db.end();
});

test(
  "REGISTER_JOB is processed and marked completed",
  async () => {
    const jobId =
      await createDatabaseJob();

    try {
      await createBlockchainOutboxEvent({
        jobId,
        eventType:
          "REGISTER_JOB",
        payload: {
          jobId,
          modelName:
            "llama-test",
          modelVersion:
            "v1.0.0",
          workerCount: 2,
          datasetHash: HASH,
        },
        idempotencyKey:
          `processor-register-${jobId}`,
      });

      const blockchain =
        new FakeBlockchainService();

      const processor =
        new BlockchainOutboxProcessor(
          blockchain as any,
          {
            batchSize: 10,
          },
        );

      const completed =
        await processor.processBatch();

      assert.equal(
        completed,
        1,
      );

      assert.deepEqual(
        blockchain.registeredJobs,
        [jobId],
      );

      const event =
        await findBlockchainOutboxByIdempotencyKey(
          `processor-register-${jobId}`,
        );

      assert.ok(event);
      assert.equal(
        event.status,
        "completed",
      );
    } finally {
      await cleanupJob(jobId);
    }
  },
);

test(
  "REGISTER_JOB is idempotent when the blockchain job already exists",
  async () => {
    const jobId =
      await createDatabaseJob();

    try {
      await createBlockchainOutboxEvent({
        jobId,
        eventType:
          "REGISTER_JOB",
        payload: {
          jobId,
          modelName:
            "llama-test",
          modelVersion:
            "v1.0.0",
          workerCount: 2,
          datasetHash: HASH,
        },
        idempotencyKey:
          `processor-register-existing-${jobId}`,
      });

      const blockchain =
        new FakeBlockchainService();

      blockchain.existingJobs.set(
        jobId,
        {
          status: {
            registered: {},
          },
          roundCount: 0,
        },
      );

      const processor =
        new BlockchainOutboxProcessor(
          blockchain as any,
        );

      const completed =
        await processor.processBatch();

      assert.equal(
        completed,
        1,
      );

      assert.deepEqual(
        blockchain.registeredJobs,
        [],
      );

      const event =
        await findBlockchainOutboxByIdempotencyKey(
          `processor-register-existing-${jobId}`,
        );

      assert.ok(event);
      assert.equal(
        event.status,
        "completed",
      );
    } finally {
      await cleanupJob(jobId);
    }
  },
);

test(
  "UPDATE_STATUS processes Anchor-style status objects",
  async () => {
    const jobId =
      await createDatabaseJob();

    try {
      await createBlockchainOutboxEvent({
        jobId,
        eventType:
          "UPDATE_STATUS",
        payload: {
          jobId,
          status:
            "running",
        },
        idempotencyKey:
          `processor-status-${jobId}`,
      });

      const blockchain =
        new FakeBlockchainService();

      blockchain.existingJobs.set(
        jobId,
        {
          status: {
            registered: {},
          },
          roundCount: 0,
        },
      );

      const processor =
        new BlockchainOutboxProcessor(
          blockchain as any,
        );

      const completed =
        await processor.processBatch();

      assert.equal(
        completed,
        1,
      );

      assert.deepEqual(
        blockchain.updatedStatuses,
        [
          {
            jobId,
            status:
              "running",
          },
        ],
      );
    } finally {
      await cleanupJob(jobId);
    }
  },
);

test(
  "UPDATE_STATUS is idempotent when status already matches",
  async () => {
    const jobId =
      await createDatabaseJob();

    try {
      await createBlockchainOutboxEvent({
        jobId,
        eventType:
          "UPDATE_STATUS",
        payload: {
          jobId,
          status:
            "running",
        },
        idempotencyKey:
          `processor-status-existing-${jobId}`,
      });

      const blockchain =
        new FakeBlockchainService();

      blockchain.existingJobs.set(
        jobId,
        {
          status: {
            running: {},
          },
          roundCount: 0,
        },
      );

      const processor =
        new BlockchainOutboxProcessor(
          blockchain as any,
        );

      const completed =
        await processor.processBatch();

      assert.equal(
        completed,
        1,
      );

      assert.deepEqual(
        blockchain.updatedStatuses,
        [],
      );
    } finally {
      await cleanupJob(jobId);
    }
  },
);

test(
  "RECORD_ROUND processes the next sequential round",
  async () => {
    const jobId =
      await createDatabaseJob();

    try {
      await createBlockchainOutboxEvent({
        jobId,
        eventType:
          "RECORD_ROUND",
        payload: {
          jobId,
          roundNumber: 1,
          checkpointHash:
            HASH,
          artifactHash:
            HASH,
          aggregationHash:
            HASH,
        },
        idempotencyKey:
          `processor-round-${jobId}`,
      });

      const blockchain =
        new FakeBlockchainService();

      blockchain.existingJobs.set(
        jobId,
        {
          status: {
            running: {},
          },
          roundCount: 0,
        },
      );

      const processor =
        new BlockchainOutboxProcessor(
          blockchain as any,
          {
            batchSize: 1,
          }
        );

      const completed =
        await processor.processBatch();

      assert.ok(
        completed >= 1,
        "Expected at least one outbox event to complete",
      );

      assert.deepEqual(
        blockchain.recordedRounds,
        [
          {
            jobId,
            roundNumber: 1,
          },
        ],
      );
    } finally {
      await cleanupJob(jobId);
    }
  },
);

test(
  "RECORD_ROUND is idempotent when the round already exists",
  async () => {
    const jobId =
      await createDatabaseJob();

    try {
      await createBlockchainOutboxEvent({
        jobId,
        eventType:
          "RECORD_ROUND",
        payload: {
          jobId,
          roundNumber: 1,
          checkpointHash:
            HASH,
          artifactHash:
            HASH,
          aggregationHash:
            HASH,
        },
        idempotencyKey:
          `processor-round-existing-${jobId}`,
      });

      const blockchain =
        new FakeBlockchainService();

      blockchain.existingJobs.set(
        jobId,
        {
          status: {
            running: {},
          },
          roundCount: 1,
        },
      );

      const processor =
        new BlockchainOutboxProcessor(
          blockchain as any,
        );

      const completed =
        await processor.processBatch();

      assert.equal(
        completed,
        1,
      );

      assert.deepEqual(
        blockchain.recordedRounds,
        [],
      );
    } finally {
      await cleanupJob(jobId);
    }
  },
);

test(
  "RECORD_ROUND rejects an out-of-order round and schedules retry",
  async () => {
    const jobId =
      await createDatabaseJob();

    try {
      await createBlockchainOutboxEvent({
        jobId,
        eventType:
          "RECORD_ROUND",
        payload: {
          jobId,
          roundNumber: 3,
          checkpointHash:
            HASH,
          artifactHash:
            HASH,
          aggregationHash:
            HASH,
        },
        idempotencyKey:
          `processor-round-invalid-${jobId}`,
      });

      const blockchain =
        new FakeBlockchainService();

      blockchain.existingJobs.set(
        jobId,
        {
          status: {
            running: {},
          },
          roundCount: 1,
        },
      );

      const processor =
        new BlockchainOutboxProcessor(
          blockchain as any,
          {
            retryDelaySeconds: 0,
          },
        );

      const completed =
        await processor.processBatch();

      assert.equal(
        completed,
        0,
      );

      assert.deepEqual(
        blockchain.recordedRounds,
        [],
      );

      const event =
        await findBlockchainOutboxByIdempotencyKey(
          `processor-round-invalid-${jobId}`,
        );

      assert.ok(event);
      assert.equal(
        event.status,
        "pending",
      );

      assert.match(
        event.lastError ?? "",
        /expected next round 2, received 3/,
      );
    } finally {
      await cleanupJob(jobId);
    }
  },
);

test(
  "blockchain failure returns the event to pending",
  async () => {
    const jobId =
      await createDatabaseJob();

    try {
      await createBlockchainOutboxEvent({
        jobId,
        eventType:
          "REGISTER_JOB",
        payload: {
          jobId,
          modelName:
            "llama-test",
          modelVersion:
            "v1.0.0",
          workerCount: 1,
          datasetHash: HASH,
        },
        idempotencyKey:
          `processor-failure-${jobId}`,
      });

      const blockchain =
        new FakeBlockchainService();

      blockchain.registerTrainingJob =
        async () => {
          throw new Error(
            "Simulated Solana RPC failure",
          );
        };

      const processor =
        new BlockchainOutboxProcessor(
          blockchain as any,
          {
            retryDelaySeconds: 0,
          },
        );

      const completed =
        await processor.processBatch();

      assert.equal(
        completed,
        0,
      );

      const event =
        await findBlockchainOutboxByIdempotencyKey(
          `processor-failure-${jobId}`,
        );

      assert.ok(event);
      assert.equal(
        event.status,
        "pending",
      );

      assert.equal(
        event.attempts,
        1,
      );

      assert.equal(
        event.lastError,
        "Simulated Solana RPC failure",
      );
    } finally {
      await cleanupJob(jobId);
    }
  },
);