import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { db } from "../src/db/pool.js";

describe("Job routes", () => {
  let app: FastifyInstance;

  /*
   * The inference test creates a model registry record
   * backed by a test artifact.
   *
   * model_registry.artifact_id uses ON DELETE RESTRICT,
   * so the model registry record must be deleted before
   * deleting the artifact.
   */
  const createdModelIds: string[] = [];
  const createdArtifactIds: string[] = [];
  const createdFixtureJobIds: string[] = [];

  before(async () => {
    app = await buildApp();

    await app.ready();
  });

  after(async () => {
    /*
     * Delete model registry records first because they
     * reference artifacts with ON DELETE RESTRICT.
     */
    if (createdModelIds.length > 0) {
      await db.query(
        `
          DELETE FROM model_registry
          WHERE model_id = ANY($1::uuid[])
        `,
        [createdModelIds],
      );
    }

    /*
     * Delete the fixture artifacts after their model
     * registry references have been removed.
     */
    if (createdArtifactIds.length > 0) {
      await db.query(
        `
          DELETE FROM artifacts
          WHERE artifact_id = ANY($1::uuid[])
        `,
        [createdArtifactIds],
      );
    }

    /*
     * Deleting the fixture jobs also removes their
     * associated tasks through the existing FK cascade.
     */
    if (createdFixtureJobIds.length > 0) {
      await db.query(
        `
          DELETE FROM jobs
          WHERE job_id = ANY($1::uuid[])
        `,
        [createdFixtureJobIds],
      );
    }

    await app.close();
    await db.end();
  });

  it("creates a training job", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      payload: {
        name: `training-job-${randomUUID()}`,
        jobType: "training",
        modelName: "test-model",
        datasetName: "test-dataset",
        config: {
          workers: 2,
          dataset: [
            "Distributed systems allow workers to cooperate.",
            "Federated learning trains models across workers.",
          ],
          epochs: 3,
          batchSize: 8,
          learningRate: 0.001,
        },
      },
    });

    assert.equal(response.statusCode, 201);

    const body = response.json();

    assert.equal(body.jobType, "training");
    assert.equal(body.modelName, "test-model");
    assert.equal(body.datasetName, "test-dataset");
    assert.equal(body.status, "pending");
    assert.ok(body.jobId);
  });

  it("creates an inference job", async () => {
    const modelName =
      "qwen2.5-1.5b-instruct-q4_k_m";

    /*
     * Inference jobs now require the requested model
     * to be registered and READY in the Model Registry.
     *
     * Create a small training job first so that we have
     * a real task that can own the model artifact.
     */
    const fixtureJobResponse = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      payload: {
        name: `model-fixture-job-${randomUUID()}`,
        jobType: "training",
        modelName,
        datasetName: "model-fixture-dataset",
        config: {
          workers: 1,
          dataset: [
            "Model registry fixture sample.",
          ],
          epochs: 1,
        },
      },
    });

    assert.equal(fixtureJobResponse.statusCode, 201);

    const fixtureJob = fixtureJobResponse.json();

    assert.ok(fixtureJob.jobId);

    /*
     * Track the fixture job.
     */
    createdFixtureJobIds.push(
      fixtureJob.jobId,
    );

    /*
     * Get the task created for the fixture job.
     */
    const taskResponse = await app.inject({
      method: "GET",
      url: `/api/v1/jobs/${fixtureJob.jobId}/tasks`,
    });

    assert.equal(taskResponse.statusCode, 200);

    const fixtureTasks = taskResponse.json();

    assert.equal(fixtureTasks.length, 1);

    const fixtureTask = fixtureTasks[0];

    assert.ok(fixtureTask.taskId);

    /*
     * Create a valid model checkpoint artifact.
     */
    const artifactId = randomUUID();

    const sha256 =
      "0000000000000000000000000000000000000000000000000000000000000000";

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
          format
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
          $9
        )
      `,
      [
        artifactId,
        fixtureTask.taskId,
        fixtureJob.jobId,
        "model_checkpoint",
        `test://models/${artifactId}`,
        sha256,
        1024,
        modelName,
        "gguf",
      ],
    );

    /*
     * Track the artifact for cleanup.
     */
    createdArtifactIds.push(artifactId);

    /*
     * Register the model through the actual HTTP API.
     */
    const registerModelResponse =
      await app.inject({
        method: "POST",
        url: "/api/v1/models",
        payload: {
          modelName,
          version: "1.0.0",
          artifactId,
          baseModelName: null,
          metadata: {
            source: "job-route-test",
          },
        },
      });

    assert.equal(
      registerModelResponse.statusCode,
      201,
    );

    const registeredModel =
      registerModelResponse.json();

    assert.ok(registeredModel.model);
    assert.ok(
      registeredModel.model.modelId,
    );

    /*
     * Track the model registry record for cleanup.
     */
    createdModelIds.push(
      registeredModel.model.modelId,
    );

    /*
     * Move the model from:
     *
     * registered
     *
     * to:
     *
     * ready
     */
    const statusResponse =
      await app.inject({
        method: "PATCH",
        url: `/api/v1/models/${registeredModel.model.modelId}/status`,
        payload: {
          status: "ready",
        },
      });

    assert.equal(
      statusResponse.statusCode,
      200,
    );

    const readyModel =
      statusResponse.json();

    assert.ok(readyModel.model);

    assert.equal(
      readyModel.model.modelId,
      registeredModel.model.modelId,
    );

    assert.equal(
      readyModel.model.status,
      "ready",
    );

    /*
     * Now create the actual inference job.
     *
     * createJobService() must resolve the READY model
     * from the Model Registry before creating the job.
     */
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      payload: {
        name: `inference-job-${randomUUID()}`,
        jobType: "inference",
        modelName,
        config: {
          workers: 1,
          prompt:
            "Explain distributed computing in simple terms.",
          maxTokens: 128,
          temperature: 0.7,
        },
      },
    });

    assert.equal(response.statusCode, 201);

    const body = response.json();

    assert.equal(body.jobType, "inference");
    assert.equal(body.modelName, modelName);
    assert.equal(body.status, "pending");
    assert.ok(body.jobId);
  });

  it("creates an evaluation job", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      payload: {
        name: `evaluation-job-${randomUUID()}`,
        jobType: "evaluation",
        modelName: "test-model",
        datasetName: "evaluation-dataset",
        config: {
          workers: 1,
          dataset: [
            "What is distributed computing?",
            "Explain federated learning.",
          ],
          metrics: ["accuracy", "loss"],
        },
      },
    });

    assert.equal(response.statusCode, 201);

    const body = response.json();

    assert.equal(body.jobType, "evaluation");
    assert.equal(body.modelName, "test-model");
    assert.equal(
      body.datasetName,
      "evaluation-dataset",
    );
    assert.equal(body.status, "pending");
    assert.ok(body.jobId);
  });

  it("creates the configured number of tasks", async () => {
    const jobName =
      `multi-worker-job-${randomUUID()}`;

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      payload: {
        name: jobName,
        jobType: "training",
        modelName: "test-model",
        datasetName: "test-dataset",
        config: {
          workers: 3,
          dataset: [
            "Training sample one.",
            "Training sample two.",
            "Training sample three.",
          ],
          epochs: 2,
          batchSize: 4,
          learningRate: 0.001,
        },
      },
    });

    assert.equal(response.statusCode, 201);

    const job = response.json();

    const taskResponse = await app.inject({
      method: "GET",
      url: `/api/v1/jobs/${job.jobId}/tasks`,
    });

    assert.equal(taskResponse.statusCode, 200);

    const tasks = taskResponse.json();

    assert.equal(tasks.length, 3);

    for (const task of tasks) {
      assert.equal(task.jobId, job.jobId);
      assert.equal(task.taskType, "training");
      assert.equal(task.status, "pending");
    }
  });

  it("creates one task by default when workers is omitted", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      payload: {
        name:
          `default-worker-job-${randomUUID()}`,
        jobType: "training",
        modelName: "test-model",
        datasetName: "test-dataset",
        config: {
          dataset: [
            "Training sample one.",
            "Training sample two.",
          ],
          epochs: 1,
          batchSize: 4,
          learningRate: 0.001,
        },
      },
    });

    assert.equal(response.statusCode, 201);

    const job = response.json();

    const taskResponse = await app.inject({
      method: "GET",
      url: `/api/v1/jobs/${job.jobId}/tasks`,
    });

    assert.equal(taskResponse.statusCode, 200);

    const tasks = taskResponse.json();

    assert.equal(tasks.length, 1);
  });

  it("rejects an inference job without a prompt", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      payload: {
        name:
          `invalid-inference-${randomUUID()}`,
        jobType: "inference",
        modelName:
          "qwen2.5-1.5b-instruct-q4_k_m",
        config: {
          workers: 1,
        },
      },
    });

    /*
     * Schema validation happens before the Model Registry
     * readiness check, so the missing prompt is a 400.
     */
    assert.equal(response.statusCode, 400);
  });

  it("rejects an invalid training configuration", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      payload: {
        name:
          `invalid-training-${randomUUID()}`,
        jobType: "training",
        modelName: "test-model",
        config: {
          workers: 1,
          epochs: 0,
          batchSize: 8,
          learningRate: 0.001,
        },
      },
    });

    assert.equal(response.statusCode, 400);
  });

  it("rejects an invalid evaluation configuration", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      payload: {
        name:
          `invalid-evaluation-${randomUUID()}`,
        jobType: "evaluation",
        modelName: "test-model",
        config: {
          workers: 1,
          metrics: [],
        },
      },
    });

    assert.equal(response.statusCode, 400);
  });

  it("gets a job by id", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      payload: {
        name: `get-job-${randomUUID()}`,
        jobType: "training",
        modelName: "test-model",
        config: {
          workers: 1,
          dataset: [
            "Distributed training sample.",
          ],
          epochs: 1,
        },
      },
    });

    assert.equal(
      createResponse.statusCode,
      201,
    );

    const createdJob =
      createResponse.json();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/jobs/${createdJob.jobId}`,
    });

    assert.equal(response.statusCode, 200);

    const body = response.json();

    assert.equal(
      body.jobId,
      createdJob.jobId,
    );
    assert.equal(
      body.name,
      createdJob.name,
    );
    assert.equal(
      body.jobType,
      "training",
    );
    assert.equal(
      body.modelName,
      "test-model",
    );
  });

  it("returns 404 for an unknown job", async () => {
    const jobId = randomUUID();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/jobs/${jobId}`,
    });

    assert.equal(response.statusCode, 404);
  });

  it("rejects an invalid job id", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/jobs/not-a-uuid",
    });

    assert.equal(response.statusCode, 400);
  });

  it("gets all jobs", async () => {
    const uniqueName =
      `list-job-${randomUUID()}`;

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      payload: {
        name: uniqueName,
        jobType: "training",
        modelName: "test-model",
        config: {
          workers: 1,
          dataset: [
            "Distributed training sample.",
          ],
          epochs: 1,
        },
      },
    });

    assert.equal(
      createResponse.statusCode,
      201,
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/jobs",
    });

    assert.equal(response.statusCode, 200);

    const jobs = response.json();

    assert.ok(Array.isArray(jobs));

    const createdJob = jobs.find(
      (job: { name: string }) =>
        job.name === uniqueName,
    );

    assert.ok(createdJob);
  });
});