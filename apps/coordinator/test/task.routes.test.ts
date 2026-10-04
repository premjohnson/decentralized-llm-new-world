
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { db } from "../src/db/pool.js";
import { buildApp } from "../src/app.js";

describe("task HTTP API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const testJobId = randomUUID();

  const testWorkerIds = [
    "worker-task-http",
    "worker-running",
    "worker-owner",
    "worker-complete",
    "worker-failure",
    "worker-requeue",
  ];

  /*
   * =========================================================
   * SETUP
   * =========================================================
   */

  before(async () => {
    app = await buildApp();

    await app.ready();

    /*
     * Create a dedicated test job.
     */
    await db.query(
      `
        INSERT INTO jobs (
          job_id,
          name,
          job_type,
          model_name
        )
        VALUES (
          $1,
          'Task HTTP Test Job',
          'training',
          'test-model'
        )
      `,
      [testJobId],
    );

    /*
     * Create real workers because tasks.worker_id
     * references workers.worker_id.
     */
    for (const workerId of testWorkerIds) {
      await db.query(
        `
          INSERT INTO workers (
            worker_id,
            hostname,
            cpu_cores,
            memory_mb,
            gpu,
            status
          )
          VALUES (
            $1,
            'task-http-test-worker',
            4,
            8192,
            FALSE,
            'online'
          )
        `,
        [workerId],
      );
    }
  });

  /*
   * =========================================================
   * CLEANUP
   * =========================================================
   */

  after(async () => {
    /*
     * tasks.job_id has ON DELETE CASCADE,
     * so deleting the job removes its tasks.
     */
    await db.query(
      `
        DELETE FROM jobs
        WHERE job_id = $1
      `,
      [testJobId],
    );

    /*
     * Remove test workers.
     */
    await db.query(
      `
        DELETE FROM workers
        WHERE worker_id = ANY($1::varchar[])
      `,
      [testWorkerIds],
    );

    await app.close();
  });

  /*
   * =========================================================
   * CREATE TASK
   * =========================================================
   */

  it("creates a task", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: testJobId,
        taskType: "training",
        payload: {
          epoch: 1,
          batchSize: 32,
        },
        maxAttempts: 3,
      },
    });

    assert.equal(response.statusCode, 201);

    const task = response.json();

    assert.ok(task.taskId);
    assert.equal(task.jobId, testJobId);
    assert.equal(task.taskType, "training");
    assert.equal(task.status, "pending");
    assert.equal(task.attempt, 0);
    assert.equal(task.maxAttempts, 3);

    assert.deepEqual(task.payload, {
      epoch: 1,
      batchSize: 32,
    });

    assert.equal(task.result, null);
  });

  /*
   * =========================================================
   * INVALID CREATE PAYLOAD
   * =========================================================
   */

  it("rejects an invalid task payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: "not-a-uuid",
        taskType: "invalid-type",
      },
    });

    assert.equal(response.statusCode, 400);

    const body = response.json();

    assert.equal(body.error, "Invalid task payload");
    assert.ok(body.details);
  });

  /*
   * =========================================================
   * UNKNOWN JOB
   * =========================================================
   */

  it("returns 404 when creating a task for an unknown job", async () => {
    const unknownJobId = randomUUID();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: unknownJobId,
        taskType: "training",
      },
    });

    assert.equal(response.statusCode, 404);

    const body = response.json();

    assert.equal(body.error, "Job not found");
  });

  /*
   * =========================================================
   * GET TASK
   * =========================================================
   */

  it("returns a task by id", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: testJobId,
        taskType: "evaluation",
        payload: {
          metric: "accuracy",
        },
      },
    });

    assert.equal(createResponse.statusCode, 201);

    const createdTask = createResponse.json();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${createdTask.taskId}`,
    });

    assert.equal(response.statusCode, 200);

    const task = response.json();

    assert.equal(task.taskId, createdTask.taskId);
    assert.equal(task.jobId, testJobId);
    assert.equal(task.taskType, "evaluation");
    assert.equal(task.result, null);
  });

  /*
   * =========================================================
   * UNKNOWN TASK
   * =========================================================
   */

  it("returns 404 for an unknown task", async () => {
    const unknownTaskId = randomUUID();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${unknownTaskId}`,
    });

    assert.equal(response.statusCode, 404);

    const body = response.json();

    assert.equal(body.error, "Task not found");
  });

  /*
   * =========================================================
   * INVALID TASK ID
   * =========================================================
   */

  it("rejects an invalid task id", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/not-a-uuid",
    });

    assert.equal(response.statusCode, 400);

    const body = response.json();

    assert.equal(body.error, "Invalid task ID");
  });

  /*
   * =========================================================
   * GET TASKS FOR JOB
   * =========================================================
   */

  it("returns all tasks for a job", async () => {
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: testJobId,
        taskType: "training",
      },
    });

    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: testJobId,
        taskType: "evaluation",
      },
    });

    assert.equal(firstResponse.statusCode, 201);
    assert.equal(secondResponse.statusCode, 201);

    const firstTask = firstResponse.json();
    const secondTask = secondResponse.json();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/jobs/${testJobId}/tasks`,
    });

    assert.equal(response.statusCode, 200);

    const tasks = response.json();

    assert.ok(Array.isArray(tasks));

    const taskIds = tasks.map(
      (task: { taskId: string }) => task.taskId,
    );

    assert.ok(taskIds.includes(firstTask.taskId));
    assert.ok(taskIds.includes(secondTask.taskId));
  });

  /*
   * =========================================================
   * UNKNOWN JOB TASK LIST
   * =========================================================
   */

  it("returns 404 when listing tasks for an unknown job", async () => {
    const unknownJobId = randomUUID();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/jobs/${unknownJobId}/tasks`,
    });

    assert.equal(response.statusCode, 404);

    const body = response.json();

    assert.equal(body.error, "Job not found");
  });

  /*
   * =========================================================
   * CLAIM TASK
   * =========================================================
   */

  it("claims a pending task for a worker", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: testJobId,
        taskType: "training",
      },
    });

    assert.equal(createResponse.statusCode, 201);

    const createdTask = createResponse.json();

    /*
     * claimNextPendingTask() intentionally selects the
     * oldest pending task globally.
     *
     * Therefore, make every other pending task for this
     * test job non-claimable while preserving the exact
     * task this test wants to claim.
     */
    await db.query(
      `
        UPDATE tasks
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE
          job_id = $1
          AND status = 'pending'
          AND task_id != $2
      `,
      [testJobId, createdTask.taskId],
    );

    /*
     * Also remove unrelated pending tasks belonging
     * to other jobs so they cannot win the global claim.
     */
    await db.query(
      `
        DELETE FROM tasks
        WHERE
          job_id != $1
          AND status = 'pending'
      `,
      [testJobId],
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/claim",
      payload: {
        workerId: "worker-task-http",
      },
    });

    assert.equal(response.statusCode, 200);

    const task = response.json();

    assert.equal(task.taskId, createdTask.taskId);
    assert.equal(task.workerId, "worker-task-http");
    assert.equal(task.status, "assigned");
    assert.equal(task.attempt, 1);
    assert.equal(task.result, null);
  });

  /*
   * =========================================================
   * INVALID CLAIM PAYLOAD
   * =========================================================
   */

  it("rejects an invalid claim payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/claim",
      payload: {
        workerId: "",
      },
    });

    assert.equal(response.statusCode, 400);

    const body = response.json();

    assert.equal(body.error, "Invalid claim payload");
  });

  /*
   * =========================================================
   * NO PENDING TASK
   * =========================================================
   */

  it("returns 204 when no pending task exists", async () => {
    await db.query(
      `
        UPDATE tasks
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE
          job_id = $1
          AND status = 'pending'
      `,
      [testJobId],
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/claim",
      payload: {
        workerId: "worker-task-http",
      },
    });

    assert.equal(response.statusCode, 204);
  });

  /*
   * =========================================================
   * RUNNING STATE
   * =========================================================
   */

  it("moves a claimed task to running", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: testJobId,
        taskType: "training",
      },
    });

    assert.equal(createResponse.statusCode, 201);

    const createdTask = createResponse.json();

    await db.query(
      `
        DELETE FROM tasks
        WHERE
          job_id != $1
          AND status = 'pending'
      `,
      [testJobId],
    );

    await db.query(
      `
        UPDATE tasks
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE
          job_id = $1
          AND status = 'pending'
          AND task_id != $2
      `,
      [testJobId, createdTask.taskId],
    );

    const claimResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/claim",
      payload: {
        workerId: "worker-running",
      },
    });

    assert.equal(claimResponse.statusCode, 200);

    const runningResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${createdTask.taskId}/running/worker-running`,
    });

    assert.equal(runningResponse.statusCode, 200);

    const task = runningResponse.json();

    assert.equal(task.status, "running");
    assert.equal(task.workerId, "worker-running");
    assert.ok(task.startedAt);
    assert.equal(task.result, null);
  });

  /*
   * =========================================================
   * WRONG WORKER CANNOT START TASK
   * =========================================================
   */

  it("rejects a different worker from starting a task", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: testJobId,
        taskType: "training",
      },
    });

    assert.equal(createResponse.statusCode, 201);

    const createdTask = createResponse.json();

    await db.query(
      `
        DELETE FROM tasks
        WHERE
          job_id != $1
          AND status = 'pending'
      `,
      [testJobId],
    );

    await db.query(
      `
        UPDATE tasks
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE
          job_id = $1
          AND status = 'pending'
          AND task_id != $2
      `,
      [testJobId, createdTask.taskId],
    );

    const claimResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/claim",
      payload: {
        workerId: "worker-owner",
      },
    });

    assert.equal(claimResponse.statusCode, 200);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${createdTask.taskId}/running/worker-task-http`,
    });

    assert.equal(response.statusCode, 409);
  });

  /*
   * =========================================================
   * COMPLETE TASK
   * =========================================================
   */

  it("completes a running task and persists its result", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: testJobId,
        taskType: "training",
      },
    });

    assert.equal(createResponse.statusCode, 201);

    const createdTask = createResponse.json();

    await db.query(
      `
        DELETE FROM tasks
        WHERE
          job_id != $1
          AND status = 'pending'
      `,
      [testJobId],
    );

    await db.query(
      `
        UPDATE tasks
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE
          job_id = $1
          AND status = 'pending'
          AND task_id != $2
      `,
      [testJobId, createdTask.taskId],
    );

    const claimResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/claim",
      payload: {
        workerId: "worker-complete",
      },
    });

    assert.equal(claimResponse.statusCode, 200);

    const runningResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${createdTask.taskId}/running/worker-complete`,
    });

    assert.equal(runningResponse.statusCode, 200);

    const completeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${createdTask.taskId}/complete/worker-complete`,
      payload: {
        result: {
          requestId: "test-request-id",
          model: "test-model",
          text: "test inference result",
        },
      },
    });

    assert.equal(completeResponse.statusCode, 200);

    const task = completeResponse.json();

    assert.equal(task.status, "completed");
    assert.ok(task.completedAt);

    assert.deepEqual(task.result, {
      requestId: "test-request-id",
      model: "test-model",
      text: "test inference result",
    });

    /*
     * Verify that the result was actually persisted
     * in PostgreSQL and can be retrieved again.
     */
    const storedResult = await db.query<{
      result: Record<string, unknown> | null;
    }>(
      `
        SELECT result
        FROM tasks
        WHERE task_id = $1
      `,
      [createdTask.taskId],
    );

    assert.deepEqual(
      storedResult.rows[0]?.result,
      {
        requestId: "test-request-id",
        model: "test-model",
        text: "test inference result",
      },
    );
  });

  /*
   * =========================================================
   * FAIL TASK → RETRYING
   * =========================================================
   */

  it("moves a failed task to pending after automatic retry", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: testJobId,
        taskType: "training",
        maxAttempts: 3,
      },
    });

    assert.equal(createResponse.statusCode, 201);

    const createdTask = createResponse.json();

    await db.query(
      `
        DELETE FROM tasks
        WHERE
          job_id != $1
          AND status = 'pending'
      `,
      [testJobId],
    );

    await db.query(
      `
        UPDATE tasks
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE
          job_id = $1
          AND status = 'pending'
          AND task_id != $2
      `,
      [testJobId, createdTask.taskId],
    );

    const claimResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/claim",
      payload: {
        workerId: "worker-failure",
      },
    });

    assert.equal(claimResponse.statusCode, 200);

    const runningResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${createdTask.taskId}/running/worker-failure`,
    });

    assert.equal(runningResponse.statusCode, 200);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${createdTask.taskId}/fail/worker-failure`,
      payload: {
        errorMessage: "Training process crashed",
      },
    });

    assert.equal(response.statusCode, 200);

    const task = response.json();

    assert.equal(task.status, "pending");
    assert.equal(task.workerId, null);

    assert.equal(
      task.errorMessage,
      "Training process crashed",
    );

    assert.ok(task.failedAt);
  });

  /*
   * =========================================================
   * INVALID FAILURE PAYLOAD
   * =========================================================
   */

  it("rejects an invalid failure payload", async () => {
    const taskId = randomUUID();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${taskId}/fail/worker-task-http`,
      payload: {
        errorMessage: "",
      },
    });

    assert.equal(response.statusCode, 400);

    const body = response.json();

    assert.equal(
      body.error,
      "Invalid failure payload",
    );
  });

  /*
   * =========================================================
   * REQUEUE TASK
   * =========================================================
   */

  it("automatically requeues a retryable failed task", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      payload: {
        jobId: testJobId,
        taskType: "training",
        maxAttempts: 3,
      },
    });

    assert.equal(createResponse.statusCode, 201);

    const createdTask = createResponse.json();

    await db.query(
      `
        DELETE FROM tasks
        WHERE
          job_id != $1
          AND status = 'pending'
      `,
      [testJobId],
    );

    await db.query(
      `
        UPDATE tasks
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE
          job_id = $1
          AND status = 'pending'
          AND task_id != $2
      `,
      [testJobId, createdTask.taskId],
    );

    const claimResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/claim",
      payload: {
        workerId: "worker-requeue",
      },
    });

    assert.equal(claimResponse.statusCode, 200);

    const runningResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${createdTask.taskId}/running/worker-requeue`,
    });

    assert.equal(runningResponse.statusCode, 200);

    const failResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${createdTask.taskId}/fail/worker-requeue`,
      payload: {
        errorMessage: "Temporary failure",
      },
    });

    assert.equal(failResponse.statusCode, 200);

    const taskResponse = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${createdTask.taskId}`,
    });

    assert.equal(taskResponse.statusCode, 200);

    const task = taskResponse.json();

    assert.equal(task.status, "pending");
    assert.equal(task.workerId, null);
    assert.equal(task.errorMessage, "Temporary failure");
  });
});