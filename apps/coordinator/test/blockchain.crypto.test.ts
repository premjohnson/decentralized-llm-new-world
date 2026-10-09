import test from "node:test";
import assert from "node:assert/strict";

import { hashJobId } from "../src/modules/blockchain/blockchain.crypto.js";

test("hashJobId returns a deterministic 32-byte hash", () => {
  const jobId = "550e8400-e29b-41d4-a716-446655440000";

  const first = hashJobId(jobId);
  const second = hashJobId(jobId);

  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
});

test("hashJobId produces different hashes for different job IDs", () => {
  const first = hashJobId("job-001");
  const second = hashJobId("job-002");

  assert.notDeepEqual(first, second);
});

test("hashJobId rejects an empty job ID", () => {
  assert.throws(
    () => hashJobId(""),
    /jobId must not be empty/,
  );
});

test("hashJobId rejects whitespace-only job IDs", () => {
  assert.throws(
    () => hashJobId("   "),
    /jobId must not be empty/,
  );
});