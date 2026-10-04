import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import pino from "pino";

import { db } from "../src/db/pool.js";
import { redis } from "../src/redis/client.js";

import {
  runTaskRecoveryWorkerCycle,
} from "../src/modules/jobs/task.recovery.worker.js";

const WORKER_ID =
  "worker-recovery-worker-test";

const RECOVERY_LOCK_KEY =
  "tasks:recovery:global-lock";

/*
 * Use a real Pino logger so the test logger matches
 * Fastify's logger type expected by the worker.
 *
 * Logging is disabled because this is an integration test.
 */
const logger = pino({
  level: "silent",
});

const createdJobIds = new Set<string>();

test.before(async () => {
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
        'recovery-worker-test',
        4,
        8192,
        FALSE,
        'online'
      )
      ON CONFLICT (worker_id)
      DO UPDATE SET
        status = 'online',
        updated_at = NOW(),
        last_heartbeat_at = NOW()
    `,
    [WORKER_ID],
  );

  if (redis.status === "wait") {
    await redis.connect();
  }
});

test.after(async () => {
  /*
   * Delete jobs created by this test file.
   *
   * Deleting the job also deletes its tasks because
   * tasks.job_id has ON DELETE CASCADE.
   */
  if (createdJobIds.size > 0) {
    await db.query(
      `
        DELETE FROM jobs
        WHERE job_id = ANY($1::uuid[])
      `,
      [Array.from(createdJobIds)],
    );
  }

  /*
   * Remove the test worker.
   */
  await db.query(
    `
      DELETE FROM workers
      WHERE worker_id = $1
    `,
    [WORKER_ID],
  );

  /*
   * Remove the distributed recovery lock.
   */
  await redis.del(RECOVERY_LOCK_KEY);

  /*
   * Close connections so this test process can exit cleanly.
   *
   * This file runs in its own Node test worker, so closing
   * these connections does not affect other test files.
   */
  if (redis.status !== "end") {
    await redis.quit();
  }

  await db.end();
});

test(
  "runs a recovery cycle and acquires the distributed lock",
  async () => {
    const jobId = randomUUID();
    const taskId = randomUUID();

    createdJobIds.add(jobId);

    await db.query(
      `
        INSERT INTO jobs (
          job_id,
          name,
          job_type,
          model_name,
          status
        )
        VALUES (
          $1,
          'recovery worker test',
          'inference',
          'test-model',
          'running'
        )
      `,
      [jobId],
    );

    await db.query(
      `
        INSERT INTO tasks (
          task_id,
          job_id,
          worker_id,
          task_type,
          status,
          payload,
          attempt,
          max_attempts,
          assigned_at
        )
        VALUES (
          $1,
          $2,
          $3,
          'inference',
          'assigned',
          '{}'::jsonb,
          1,
          3,
          NOW() - INTERVAL '10 minutes'
        )
      `,
      [
        taskId,
        jobId,
        WORKER_ID,
      ],
    );

    const result =
      await runTaskRecoveryWorkerCycle(
        logger,
        {
          timeoutSeconds: 300,
        },
      );

    assert.equal(
      result.acquiredLock,
      true,
    );

    assert.equal(
      result.recoveredTasks,
      1,
    );

    assert.equal(
      result.requeuedCount,
      1,
    );

    assert.equal(
      result.failedCount,
      0,
    );

    const taskResult =
      await db.query<{
        status: string;
        worker_id: string | null;
        assigned_at: Date | null;
        started_at: Date | null;
      }>(
        `
          SELECT
            status,
            worker_id,
            assigned_at,
            started_at
          FROM tasks
          WHERE task_id = $1
        `,
        [taskId],
      );

    assert.equal(
      taskResult.rows[0]?.status,
      "pending",
    );

    assert.equal(
      taskResult.rows[0]?.worker_id,
      null,
    );

    assert.equal(
      taskResult.rows[0]?.assigned_at,
      null,
    );

    assert.equal(
      taskResult.rows[0]?.started_at,
      null,
    );
  },
);

test(
  "skips recovery when another Coordinator owns the lock",
  async () => {
    const acquired =
      await redis.set(
        RECOVERY_LOCK_KEY,
        "another-coordinator",
        "EX",
        30,
        "NX",
      );

    assert.equal(
      acquired,
      "OK",
    );

    const result =
      await runTaskRecoveryWorkerCycle(
        logger,
        {
          timeoutSeconds: 300,
        },
      );

    assert.equal(
      result.acquiredLock,
      false,
    );

    assert.equal(
      result.recoveredTasks,
      0,
    );

    assert.equal(
      result.requeuedCount,
      0,
    );

    assert.equal(
      result.failedCount,
      0,
    );

    const owner =
      await redis.get(
        RECOVERY_LOCK_KEY,
      );

    assert.equal(
      owner,
      "another-coordinator",
    );

    await redis.del(
      RECOVERY_LOCK_KEY,
    );
  },
);

test(
  "rejects an invalid recovery timeout",
  async () => {
    await assert.rejects(
      () =>
        runTaskRecoveryWorkerCycle(
          logger,
          {
            timeoutSeconds: 0,
          },
        ),
      /Task timeout must be a positive integer/,
    );
  },
);