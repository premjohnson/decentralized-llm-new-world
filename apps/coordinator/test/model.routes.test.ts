import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { db } from "../src/db/pool.js";

describe("Model Registry HTTP API", async () => {
  const modelIds: string[] = [];
  const testTaskIds: string[] = [];
  const testArtifactIds: string[] = [];

  let app: Awaited<ReturnType<typeof buildApp>>;
  let testJobId: string;

  before(async () => {
    app = await buildApp();

    /*
     * Create one test job.
     *
     * Each model registration gets its own task + artifact because
     * model_registry intentionally enforces:
     *
     *   UNIQUE (artifact_id)
     *
     * and artifacts enforce uniqueness per:
     *
     *   UNIQUE (task_id, artifact_type)
     */
    const jobResult = await db.query<{
      job_id: string;
    }>(
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
          $3,
          $4,
          $5,
          $6
        )
        RETURNING job_id
      `,
      [
        randomUUID(),
        "model-registry-test-job",
        "training",
        "test-model",
        "test-dataset",
        JSON.stringify({}),
      ],
    );

    testJobId = jobResult.rows[0].job_id;
  });

  /*
   * Creates a fresh task + artifact for each model test.
   *
   * This is important because an artifact can belong to only one
   * registered model.
   */
  async function createTestArtifact(): Promise<string> {
    const taskId = randomUUID();
    const artifactId = randomUUID();

    await db.query(
      `
        INSERT INTO tasks (
          task_id,
          job_id,
          task_type,
          status,
          payload
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5
        )
      `,
      [
        taskId,
        testJobId,
        "training",
        "completed",
        JSON.stringify({}),
      ],
    );

    await db.query(
      `
        INSERT INTO artifacts (
          artifact_id,
          task_id,
          job_id,
          artifact_type,
          storage_uri,
          sha256,
          size_bytes,
          model_name,
          format,
          sample_count
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10
        )
      `,
      [
        artifactId,
        taskId,
        testJobId,
        "lora_adapter",
        `file:///tmp/${artifactId}.safetensors`,
        "a".repeat(64),
        1024,
        "test-model",
        "safetensors",
        1,
      ],
    );

    testTaskIds.push(taskId);
    testArtifactIds.push(artifactId);

    return artifactId;
  }

  after(async () => {
    /*
     * Delete model registry records first because they reference
     * artifacts through a foreign key.
     */
    if (modelIds.length > 0) {
      await db.query(
        `
          DELETE FROM model_registry
          WHERE model_id = ANY($1::uuid[])
        `,
        [modelIds],
      );
    }

    /*
     * Delete artifacts before their tasks.
     */
    if (testArtifactIds.length > 0) {
      await db.query(
        `
          DELETE FROM artifacts
          WHERE artifact_id = ANY($1::uuid[])
        `,
        [testArtifactIds],
      );
    }

    /*
     * Delete the test tasks after their artifacts are gone.
     */
    if (testTaskIds.length > 0) {
      await db.query(
        `
          DELETE FROM tasks
          WHERE task_id = ANY($1::uuid[])
        `,
        [testTaskIds],
      );
    }

    /*
     * Finally delete the test job.
     */
    if (testJobId) {
      await db.query(
        `
          DELETE FROM jobs
          WHERE job_id = $1
        `,
        [testJobId],
      );
    }

    await app.close();
    await db.end();
  });

  it("registers a model", async () => {
    const artifactId = await createTestArtifact();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/models",
      payload: {
        modelName: "test-model",
        version: "1.0.0",
        artifactId,
      },
    });

    assert.equal(response.statusCode, 201);

    const body = response.json();

    assert.ok(body.model);

    assert.equal(body.model.modelName, "test-model");
    assert.equal(body.model.version, "1.0.0");
    assert.equal(body.model.artifactId, artifactId);
    assert.equal(body.model.status, "registered");

    modelIds.push(body.model.modelId);
  });

  it("rejects an invalid model payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/models",
      payload: {
        modelName: "",
        version: "1.0.0",
        artifactId: "not-a-uuid",
      },
    });

    assert.equal(response.statusCode, 400);

    const body = response.json();

    assert.equal(body.error, "Invalid model payload");
  });

  it("returns a model by id", async () => {
    const artifactId = await createTestArtifact();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/models",
      payload: {
        modelName: "get-by-id-model",
        version: "1.0.0",
        artifactId,
      },
    });

    assert.equal(createResponse.statusCode, 201);

    const created = createResponse.json();

    modelIds.push(created.model.modelId);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/models/${created.model.modelId}`,
    });

    assert.equal(response.statusCode, 200);

    const body = response.json();

    assert.equal(
      body.model.modelId,
      created.model.modelId,
    );

    assert.equal(
      body.model.modelName,
      "get-by-id-model",
    );

    assert.equal(
      body.model.version,
      "1.0.0",
    );

    assert.equal(
      body.model.artifactId,
      artifactId,
    );
  });

  it("returns 404 for an unknown model", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/models/${randomUUID()}`,
    });

    assert.equal(response.statusCode, 404);

    const body = response.json();

    assert.equal(body.error, "Model not found");
  });

  it("rejects an invalid model id", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/models/not-a-uuid",
    });

    assert.equal(response.statusCode, 400);

    const body = response.json();

    /*
     * Match the API's existing error contract exactly.
     */
    assert.equal(body.error, "Invalid model ID");
  });

  it("returns the latest ready model", async () => {
    const artifactId = await createTestArtifact();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/models",
      payload: {
        modelName: "ready-test-model",
        version: "2.0.0",
        artifactId,
      },
    });

    assert.equal(createResponse.statusCode, 201);

    const created = createResponse.json();

    modelIds.push(created.model.modelId);

    const statusResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/models/${created.model.modelId}/status`,
      payload: {
        status: "ready",
      },
    });

    assert.equal(statusResponse.statusCode, 200);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/models/ready-test-model/ready",
    });

    assert.equal(response.statusCode, 200);

    const readyBody = response.json();

    assert.equal(
      readyBody.model.modelName,
      "ready-test-model",
    );

    assert.equal(
      readyBody.model.version,
      "2.0.0",
    );

    assert.equal(
      readyBody.model.status,
      "ready",
    );

    assert.equal(
      readyBody.model.artifactId,
      artifactId,
    );
  });

  it("updates model status", async () => {
    const artifactId = await createTestArtifact();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/models",
      payload: {
        modelName: "status-test-model",
        version: "1.0.0",
        artifactId,
      },
    });

    assert.equal(createResponse.statusCode, 201);

    const created = createResponse.json();

    modelIds.push(created.model.modelId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/models/${created.model.modelId}/status`,
      payload: {
        status: "ready",
      },
    });

    assert.equal(response.statusCode, 200);

    const body = response.json();

    assert.equal(
      body.model.modelId,
      created.model.modelId,
    );

    assert.equal(
      body.model.status,
      "ready",
    );
  });

  it("rejects an invalid model status", async () => {
    const modelId = randomUUID();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/models/${modelId}/status`,
      payload: {
        status: "invalid-status",
      },
    });

    assert.equal(response.statusCode, 400);

    const body = response.json();

    assert.equal(
      body.error,
      "Invalid model status",
    );
  });
});