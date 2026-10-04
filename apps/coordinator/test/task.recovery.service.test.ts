import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runTaskRecoveryCycle } from "../src/modules/jobs/task.recovery.service.js";

describe("task recovery service", () => {
  it("rejects an invalid timeout", async () => {
    await assert.rejects(
      () =>
        runTaskRecoveryCycle({
          timeoutSeconds: 0,
        }),
      /Task timeout must be a positive integer/,
    );

    await assert.rejects(
      () =>
        runTaskRecoveryCycle({
          timeoutSeconds: -10,
        }),
      /Task timeout must be a positive integer/,
    );

    await assert.rejects(
      () =>
        runTaskRecoveryCycle({
          timeoutSeconds: 1.5,
        }),
      /Task timeout must be a positive integer/,
    );
  });
});