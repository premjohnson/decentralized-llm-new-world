import assert from "node:assert/strict";
import test from "node:test";

import {
  createJobSchema,
} from "../src/modules/jobs/job.schema.js";

test(
  "accepts a valid training job",
  () => {
    const result =
      createJobSchema.safeParse({
        name: "training smoke test",
        jobType: "training",
        modelName: "sshleifer/tiny-gpt2",
        config: {
          workers: 1,

          dataset: [
            "Distributed systems allow workers to cooperate.",
            "Federated learning trains models across workers.",
          ],

          epochs: 1,
          batchSize: 1,
          learningRate: 0.0002,
          maxLength: 64,

          lora: {
            r: 4,
            alpha: 8,
            dropout: 0.05,
          },
        },
      });

    assert.equal(result.success, true);
  },
);

test(
  "rejects a training job without a dataset",
  () => {
    const result =
      createJobSchema.safeParse({
        name: "invalid training job",
        jobType: "training",
        modelName: "sshleifer/tiny-gpt2",
        config: {
          epochs: 1,
        },
      });

    assert.equal(result.success, false);
  },
);