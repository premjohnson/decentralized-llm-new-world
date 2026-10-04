import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";

import { db } from "../src/db/pool.js";
import { runSchedulerCycle } from "../src/modules/scheduler/scheduler.service.js";

describe("scheduler service", () => {
  const createdJobIds: string[] = [];

  after(async () => {
    if (createdJobIds.length === 0) {
      return;
    }

    await db.query(
      `
        DELETE FROM jobs
        WHERE job_id = ANY($1::uuid[])
      `,
      [createdJobIds],
    );
  });

  test("moves a pending job with persisted tasks to running", async () => {
    const jobId = randomUUID();
    const taskId = randomUUID();

    createdJobIds.push(jobId);

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
          'Scheduler Reconciliation Training Job',
          'training',
          'test-model',
          'test-dataset',
          $2::jsonb
        )
      `,
      [
        jobId,
        JSON.stringify({
          workers: 1,
        }),
      ],
    );

    await db.query(
      `
        INSERT INTO tasks (
          task_id,
          job_id,
          task_type,
          payload,
          max_attempts
        )
        VALUES (
          $1,
          $2,
          'training',
          $3::jsonb,
          3
        )
      `,
      [
        taskId,
        jobId,
        JSON.stringify({
          jobId,
          modelName: "test-model",
          datasetName: "test-dataset",
          config: {
            workers: 1,
          },
          taskIndex: 0,
          totalTasks: 1,
        }),
      ],
    );

    const result = await runSchedulerCycle();

    assert.equal(result.jobsProcessed >= 1, true);
    assert.equal(result.jobsStarted >= 1, true);

    const jobResult = await db.query<{
      status: string;
      started_at: Date | null;
    }>(
      `
        SELECT
          status,
          started_at
        FROM jobs
        WHERE job_id = $1
      `,
      [jobId],
    );

    const job = jobResult.rows[0];

    assert.ok(job);
    assert.equal(job.status, "running");
    assert.ok(job.started_at instanceof Date);

    const taskResult = await db.query<{
      task_id: string;
      task_type: string;
      status: string;
    }>(
      `
        SELECT
          task_id,
          task_type,
          status
        FROM tasks
        WHERE job_id = $1
      `,
      [jobId],
    );

    assert.equal(taskResult.rows.length, 1);

    const task = taskResult.rows[0];

    assert.ok(task);
    assert.equal(task.task_id, taskId);
    assert.equal(task.task_type, "training");
    assert.equal(task.status, "pending");
  });

  test("leaves a pending job pending when it has no tasks", async () => {
    const jobId = randomUUID();

    createdJobIds.push(jobId);

    await db.query(
      `
        INSERT INTO jobs (
          job_id,
          name,
          job_type,
          model_name,
          config
        )
        VALUES (
          $1,
          'Scheduler Waiting Job',
          'inference',
          'test-model',
          '{}'::jsonb
        )
      `,
      [jobId],
    );

    const result = await runSchedulerCycle();

    assert.equal(result.jobsProcessed >= 1, true);
    assert.equal(result.jobsStarted, 0);
    assert.equal(result.jobsWaitingForTasks >= 1, true);

    const jobResult = await db.query<{
      status: string;
      started_at: Date | null;
    }>(
      `
        SELECT
          status,
          started_at
        FROM jobs
        WHERE job_id = $1
      `,
      [jobId],
    );

    const job = jobResult.rows[0];

    assert.ok(job);
    assert.equal(job.status, "pending");
    assert.equal(job.started_at, null);

    const taskResult = await db.query<{
      count: string;
    }>(
      `
        SELECT COUNT(*)::text AS count
        FROM tasks
        WHERE job_id = $1
      `,
      [jobId],
    );

    assert.equal(Number(taskResult.rows[0]?.count), 0);
  });

  test("does not create duplicate tasks when scheduler runs repeatedly", async () => {
    const jobId = randomUUID();
    const taskId = randomUUID();

    createdJobIds.push(jobId);

    await db.query(
      `
        INSERT INTO jobs (
          job_id,
          name,
          job_type,
          model_name,
          config
        )
        VALUES (
          $1,
          'Scheduler Idempotency Job',
          'evaluation',
          'test-model',
          $2::jsonb
        )
      `,
      [
        jobId,
        JSON.stringify({
          workers: 2,
        }),
      ],
    );

    await db.query(
      `
        INSERT INTO tasks (
          task_id,
          job_id,
          task_type,
          payload,
          max_attempts
        )
        VALUES (
          $1,
          $2,
          'evaluation',
          $3::jsonb,
          3
        )
      `,
      [
        taskId,
        jobId,
        JSON.stringify({
          jobId,
          modelName: "test-model",
          config: {
            workers: 2,
          },
          taskIndex: 0,
          totalTasks: 2,
        }),
      ],
    );

    const firstRun = await runSchedulerCycle();

    assert.equal(firstRun.jobsStarted >= 1, true);

    const firstTaskResult = await db.query<{
      count: string;
    }>(
      `
        SELECT COUNT(*)::text AS count
        FROM tasks
        WHERE job_id = $1
      `,
      [jobId],
    );

    assert.equal(Number(firstTaskResult.rows[0]?.count), 1);

    const secondRun = await runSchedulerCycle();

    assert.equal(secondRun.jobsStarted, 0);

    const secondTaskResult = await db.query<{
      count: string;
    }>(
      `
        SELECT COUNT(*)::text AS count
        FROM tasks
        WHERE job_id = $1
      `,
      [jobId],
    );

    assert.equal(Number(secondTaskResult.rows[0]?.count), 1);

    const jobResult = await db.query<{
      status: string;
    }>(
      `
        SELECT status
        FROM jobs
        WHERE job_id = $1
      `,
      [jobId],
    );

    assert.equal(jobResult.rows[0]?.status, "running");
  });

  test("processes multiple pending jobs with existing tasks", async () => {
    const jobId1 = randomUUID();
    const jobId2 = randomUUID();

    const taskId1 = randomUUID();
    const taskId2 = randomUUID();

    createdJobIds.push(jobId1, jobId2);

    await db.query(
      `
        INSERT INTO jobs (
          job_id,
          name,
          job_type,
          model_name,
          config
        )
        VALUES
          (
            $1,
            'Scheduler Multi Job One',
            'training',
            'model-one',
            '{}'::jsonb
          ),
          (
            $2,
            'Scheduler Multi Job Two',
            'evaluation',
            'model-two',
            '{}'::jsonb
          )
      `,
      [jobId1, jobId2],
    );

    await db.query(
      `
        INSERT INTO tasks (
          task_id,
          job_id,
          task_type,
          payload,
          max_attempts
        )
        VALUES
          (
            $1,
            $3,
            'training',
            $5::jsonb,
            3
          ),
          (
            $2,
            $4,
            'evaluation',
            $6::jsonb,
            3
          )
      `,
      [
        taskId1,
        taskId2,
        jobId1,
        jobId2,
        JSON.stringify({
          jobId: jobId1,
          modelName: "model-one",
          taskIndex: 0,
          totalTasks: 1,
        }),
        JSON.stringify({
          jobId: jobId2,
          modelName: "model-two",
          taskIndex: 0,
          totalTasks: 1,
        }),
      ],
    );

    const result = await runSchedulerCycle();

    assert.equal(result.jobsProcessed >= 2, true);
    assert.equal(result.jobsStarted >= 2, true);

    const jobResult = await db.query<{
      job_id: string;
      status: string;
    }>(
      `
        SELECT
          job_id,
          status
        FROM jobs
        WHERE job_id IN ($1, $2)
      `,
      [jobId1, jobId2],
    );

    assert.equal(jobResult.rows.length, 2);

    for (const job of jobResult.rows) {
      assert.equal(job.status, "running");
    }

    const taskResult = await db.query<{
      job_id: string;
      count: string;
    }>(
      `
        SELECT
          job_id,
          COUNT(*)::text AS count
        FROM tasks
        WHERE job_id IN ($1, $2)
        GROUP BY job_id
      `,
      [jobId1, jobId2],
    );

    assert.equal(taskResult.rows.length, 2);

    const counts = new Map(
      taskResult.rows.map((row) => [
        row.job_id,
        Number(row.count),
      ]),
    );

    assert.equal(counts.get(jobId1), 1);
    assert.equal(counts.get(jobId2), 1);
  });

  test("rejects an invalid scheduler batch size", async () => {
    await assert.rejects(
      () =>
        runSchedulerCycle({
          batchSize: 0,
        }),
      /Scheduler batch size must be a positive integer/,
    );

    await assert.rejects(
      () =>
        runSchedulerCycle({
          batchSize: 1.5,
        }),
      /Scheduler batch size must be a positive integer/,
    );
  });
});