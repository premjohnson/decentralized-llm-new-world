import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { db } from "../src/db/pool.js";

const TEST_WORKER_ID = "test-worker-http";

describe("worker HTTP API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  before(async () => {
    await db.query("DELETE FROM workers WHERE worker_id = $1", [
      TEST_WORKER_ID,
    ]);

    app = await buildApp();

    await app.ready();
  });

  after(async () => {
    await app.close();

    await db.query("DELETE FROM workers WHERE worker_id = $1", [
      TEST_WORKER_ID,
    ]);
  });

  it("registers a worker", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workers/register",
      payload: {
        workerId: TEST_WORKER_ID,
        hostname: "test-http-host",
        capabilities: {
          cpuCores: 8,
          memoryMb: 16384,
          gpu: true,
          gpuModel: "Test GPU",
          vramMb: 4096,
        },
      },
    });

    assert.equal(response.statusCode, 201);

    const body = response.json();

    assert.equal(body.data.workerId, TEST_WORKER_ID);
    assert.equal(body.data.hostname, "test-http-host");
    assert.equal(body.data.status, "online");
  });

  it("rejects invalid registration payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workers/register",
      payload: {
        workerId: "",
      },
    });

    assert.equal(response.statusCode, 400);

    const body = response.json();

    assert.equal(body.error, "VALIDATION_ERROR");
  });

  it("returns all registered workers", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/workers",
    });

    assert.equal(response.statusCode, 200);

    const body = response.json();

    assert.ok(Array.isArray(body.data));

    const worker = body.data.find(
      (item: { workerId: string }) =>
        item.workerId === TEST_WORKER_ID,
    );

    assert.ok(worker);
  });

  it("returns a worker by id", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/workers/${TEST_WORKER_ID}`,
    });

    assert.equal(response.statusCode, 200);

    const body = response.json();

    assert.equal(body.data.workerId, TEST_WORKER_ID);
  });

  it("returns 404 for an unknown worker", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/workers/does-not-exist",
    });

    assert.equal(response.statusCode, 404);

    const body = response.json();

    assert.equal(body.error, "WORKER_NOT_FOUND");
  });

  it("updates worker heartbeat", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/workers/${TEST_WORKER_ID}/heartbeat`,
    });

    assert.equal(response.statusCode, 200);

    const body = response.json();

    assert.equal(body.data.workerId, TEST_WORKER_ID);
    assert.equal(body.data.status, "online");
    assert.ok(body.data.lastHeartbeatAt);
  });

  it("returns 404 when heartbeating an unknown worker", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workers/does-not-exist/heartbeat",
    });

    assert.equal(response.statusCode, 404);

    const body = response.json();

    assert.equal(body.error, "WORKER_NOT_FOUND");
  });
});