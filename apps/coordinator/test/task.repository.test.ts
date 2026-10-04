import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { db } from "../src/db/pool.js";
import {
  claimNextPendingTask,
  createTask,
  findTaskById,
  findTasksByJobId,
  markTaskCompleted,
  markTaskFailed,
  markTaskRunning,
  requeueTask,
} from "../src/modules/jobs/task.repository.js";

const TEST_JOB_ID = randomUUID();

describe("task repository", () => {
  before(async () => {
    await db.query(
      `
        INSERT INTO jobs (
          job_id,
          name,
          job_type,
          model_name
        )
        VALUES ($1, 'Task Repository Test Job', 'training', 'test-model')
      `,
      [TEST_JOB_ID],
    );
  });

  beforeEach(async () => {
    await db.query(
      "DELETE FROM tasks WHERE job_id = $1",
      [TEST_JOB_ID],
    );
  });

  after(async () => {
    await db.query(
      "DELETE FROM jobs WHERE job_id = $1",
      [TEST_JOB_ID],
    );
  });

  it("creates a task", async () => {
    const taskId = randomUUID();

    const task = await createTask({
      taskId,
      jobId: TEST_JOB_ID,
      taskType: "training",
      payload: {
        epoch: 1,
        batchSize: 32,
      },
      maxAttempts: 3,
    });

    assert.equal(task.taskId, taskId);
    assert.equal(task.jobId, TEST_JOB_ID);
    assert.equal(task.taskType, "training");
    assert.equal(task.status, "pending");
    assert.equal(task.attempt, 0);
    assert.equal(task.maxAttempts, 3);

    assert.deepEqual(task.payload, {
      epoch: 1,
      batchSize: 32,
    });
  });

  it("finds a task by id", async () => {
    const taskId = randomUUID();

    await createTask({
      taskId,
      jobId: TEST_JOB_ID,
      taskType: "training",
    });

    const task = await findTaskById(taskId);

    assert.ok(task);
    assert.equal(task.taskId, taskId);
    assert.equal(task.jobId, TEST_JOB_ID);
  });

  it("finds tasks by job id", async () => {
    const taskId = randomUUID();

    await createTask({
      taskId,
      jobId: TEST_JOB_ID,
      taskType: "evaluation",
    });

    const tasks = await findTasksByJobId(TEST_JOB_ID);

    assert.ok(tasks.length >= 1);

    const task = tasks.find(
      (item) => item.taskId === taskId,
    );

    assert.ok(task);
    assert.equal(task.jobId, TEST_JOB_ID);
  });

  it("claims a pending task for a worker", async () => {
    const taskId = randomUUID();

    await createTask({
      taskId,
      jobId: TEST_JOB_ID,
      taskType: "training",
    });

    /*
     * The repository intentionally claims the oldest pending
     * task globally. Therefore, this test database must not
     * contain unrelated pending tasks.
     */
    await db.query(
      `
        DELETE FROM tasks
        WHERE job_id != $1
          AND status = 'pending'
      `,
      [TEST_JOB_ID],
    );

    const claimed = await claimNextPendingTask("worker-01");

    assert.ok(claimed);
    assert.equal(claimed.taskId, taskId);
    assert.equal(claimed.workerId, "worker-01");
    assert.equal(claimed.status, "assigned");
    assert.equal(claimed.attempt, 1);
    assert.ok(claimed.assignedAt);
  });

  it("does not claim the same task twice", async () => {
    const taskId = randomUUID();

    await createTask({
      taskId,
      jobId: TEST_JOB_ID,
      taskType: "training",
    });

    await db.query(
      `
        DELETE FROM tasks
        WHERE job_id != $1
          AND status = 'pending'
      `,
      [TEST_JOB_ID],
    );

    const firstClaim = await claimNextPendingTask("worker-01");

    assert.ok(firstClaim);
    assert.equal(firstClaim.taskId, taskId);

    const secondClaim = await claimNextPendingTask("worker-02");

    assert.notEqual(secondClaim?.taskId, taskId);
  });

  it("moves an assigned task to running", async () => {
    const taskId = randomUUID();

    await createTask({
      taskId,
      jobId: TEST_JOB_ID,
      taskType: "training",
    });

    await db.query(
      `
        DELETE FROM tasks
        WHERE job_id != $1
          AND status = 'pending'
      `,
      [TEST_JOB_ID],
    );

    const claimed = await claimNextPendingTask("worker-01");

    assert.ok(claimed);
    assert.equal(claimed.taskId, taskId);

    const running = await markTaskRunning(
      taskId,
      "worker-01",
    );

    assert.ok(running);
    assert.equal(running.status, "running");
    assert.equal(running.workerId, "worker-01");
    assert.ok(running.startedAt);
  });

  it("completes a running task", async () => {
    const taskId = randomUUID();

    await createTask({
      taskId,
      jobId: TEST_JOB_ID,
      taskType: "training",
    });

    await db.query(
      `
        DELETE FROM tasks
        WHERE job_id != $1
          AND status = 'pending'
      `,
      [TEST_JOB_ID],
    );

    const claimed = await claimNextPendingTask("worker-01");

    assert.ok(claimed);
    assert.equal(claimed.taskId, taskId);

    const running = await markTaskRunning(
      taskId,
      "worker-01",
    );

    assert.ok(running);

    const completed = await markTaskCompleted(
      taskId,
      "worker-01",
    );

    assert.ok(completed);
    assert.equal(completed.status, "completed");
    assert.ok(completed.completedAt);
  });

  it("moves a failed task to retrying when attempts remain", async () => {
    const taskId = randomUUID();

    await createTask({
      taskId,
      jobId: TEST_JOB_ID,
      taskType: "training",
      maxAttempts: 3,
    });

    await db.query(
      `
        DELETE FROM tasks
        WHERE job_id != $1
          AND status = 'pending'
      `,
      [TEST_JOB_ID],
    );

    const claimed = await claimNextPendingTask("worker-01");

    assert.ok(claimed);
    assert.equal(claimed.taskId, taskId);

    const running = await markTaskRunning(
      taskId,
      "worker-01",
    );

    assert.ok(running);

    const failed = await markTaskFailed(
      taskId,
      "worker-01",
      "Worker crashed during training",
    );

    assert.ok(failed);
    assert.equal(failed.status, "retrying");
    assert.equal(
      failed.errorMessage,
      "Worker crashed during training",
    );
    assert.ok(failed.failedAt);
  });

  it("requeues a retrying task", async () => {
    const taskId = randomUUID();

    await createTask({
      taskId,
      jobId: TEST_JOB_ID,
      taskType: "training",
      maxAttempts: 3,
    });

    await db.query(
      `
        DELETE FROM tasks
        WHERE job_id != $1
          AND status = 'pending'
      `,
      [TEST_JOB_ID],
    );

    const claimed = await claimNextPendingTask("worker-01");

    assert.ok(claimed);
    assert.equal(claimed.taskId, taskId);

    const running = await markTaskRunning(
      taskId,
      "worker-01",
    );

    assert.ok(running);

    const failed = await markTaskFailed(
      taskId,
      "worker-01",
      "Temporary worker failure",
    );

    assert.ok(failed);
    assert.equal(failed.status, "retrying");

    const requeued = await requeueTask(taskId);

    assert.ok(requeued);
    assert.equal(requeued.status, "pending");
    assert.equal(requeued.workerId, null);
  });

  it("permanently fails a task after max attempts", async () => {
    const taskId = randomUUID();

    await createTask({
      taskId,
      jobId: TEST_JOB_ID,
      taskType: "training",
      maxAttempts: 1,
    });

    await db.query(
      `
        DELETE FROM tasks
        WHERE job_id != $1
          AND status = 'pending'
      `,
      [TEST_JOB_ID],
    );

    const claimed = await claimNextPendingTask("worker-01");

    assert.ok(claimed);
    assert.equal(claimed.taskId, taskId);

    const running = await markTaskRunning(
      taskId,
      "worker-01",
    );

    assert.ok(running);

    const failed = await markTaskFailed(
      taskId,
      "worker-01",
      "Permanent failure",
    );

    assert.ok(failed);
    assert.equal(failed.status, "failed");
    assert.equal(failed.attempt, 1);
  });
});