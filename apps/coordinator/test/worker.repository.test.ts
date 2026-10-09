import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { db } from "../src/db/pool.js";
import {
  findWorkerById,
  markStaleWorkersOffline,
  updateWorkerHeartbeat,
  upsertWorker,
} from "../src/modules/workers/worker.repository.js";

const TEST_WORKER_ID = "test-worker-repository";

describe("worker repository", () => {
  before(async () => {
    await db.query("DELETE FROM workers WHERE worker_id = $1", [
      TEST_WORKER_ID,
    ]);
  });

  after(async () => {
    await db.query("DELETE FROM workers WHERE worker_id = $1", [
      TEST_WORKER_ID,
    ]);
  });

  it("creates a worker in PostgreSQL", async () => {
    const worker = await upsertWorker({
      workerId: TEST_WORKER_ID,
      hostname: "test-host",
      cpuCores: 8,
      memoryMb: 16384,
      gpu: true,
      gpuModel: "Test GPU",
      vramMb: 4096,
    });

    assert.equal(worker.workerId, TEST_WORKER_ID);
    assert.equal(worker.hostname, "test-host");
    assert.equal(worker.cpuCores, 8);
    assert.equal(worker.memoryMb, 16384);
    assert.equal(worker.gpu, true);
    assert.equal(worker.gpuModel, "Test GPU");
    assert.equal(worker.vramMb, 4096);
    assert.equal(worker.status, "online");
  });

  it("reads the worker from PostgreSQL", async () => {
    const worker = await findWorkerById(TEST_WORKER_ID);

    assert.ok(worker);
    assert.equal(worker.workerId, TEST_WORKER_ID);
    assert.equal(worker.status, "online");
  });

  it("updates the worker heartbeat", async () => {
    const beforeHeartbeat = await findWorkerById(TEST_WORKER_ID);

    assert.ok(beforeHeartbeat);

    const updated = await updateWorkerHeartbeat(TEST_WORKER_ID);

    assert.ok(updated);
    assert.equal(updated.status, "online");

    assert.ok(
      updated.lastHeartbeatAt.getTime() >=
        beforeHeartbeat.lastHeartbeatAt.getTime(),
    );
  });

  it("marks stale workers offline", async () => {
    await db.query(
      `
        UPDATE workers
        SET
          status = 'online',
          last_heartbeat_at = NOW() - INTERVAL '120 seconds'
        WHERE worker_id = $1
      `,
      [TEST_WORKER_ID],
    );

    const staleWorkers = await markStaleWorkersOffline(45);

    const staleWorker = staleWorkers.find(
      (worker) => worker.workerId === TEST_WORKER_ID,
    );

    assert.ok(staleWorker);
    assert.equal(staleWorker.status, "offline");

    const persisted = await findWorkerById(TEST_WORKER_ID);

    assert.ok(persisted);
    assert.equal(persisted.status, "offline");
  });

  it("restores an offline worker to online after a heartbeat", async () => {
    await db.query(
      `
        UPDATE workers
        SET
          status = 'offline',
          last_heartbeat_at = NOW() - INTERVAL '120 seconds'
        WHERE worker_id = $1
      `,
      [TEST_WORKER_ID],
    );

    const recovered = await updateWorkerHeartbeat(TEST_WORKER_ID);

    assert.ok(recovered);
    assert.equal(recovered.status, "online");

    const persisted = await findWorkerById(TEST_WORKER_ID);

    assert.ok(persisted);
    assert.equal(persisted.status, "online");
  });

  it("updates an existing worker on re-registration without creating a duplicate", async () => {
    const original = await findWorkerById(TEST_WORKER_ID);

    assert.ok(original);

    const updated = await upsertWorker({
      workerId: TEST_WORKER_ID,
      hostname: "re-registered-host",
      cpuCores: 16,
      memoryMb: 32768,
      gpu: false,
    });

    assert.equal(updated.workerId, TEST_WORKER_ID);
    assert.equal(updated.hostname, "re-registered-host");
    assert.equal(updated.cpuCores, 16);
    assert.equal(updated.memoryMb, 32768);
    assert.equal(updated.gpu, false);
    assert.equal(updated.status, "online");

    const count = await db.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM workers
        WHERE worker_id = $1
      `,
      [TEST_WORKER_ID],
    );

    assert.equal(count.rows[0]?.count, "1");
  });
});
