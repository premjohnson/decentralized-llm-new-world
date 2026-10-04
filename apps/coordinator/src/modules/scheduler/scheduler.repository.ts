import { db } from "../../db/pool.js";

export interface PendingJobRecord {
  jobId: string;
  name: string;
  jobType: "training" | "inference" | "evaluation";
  status: "pending";
  modelName: string;
  datasetName: string | null;
  config: Record<string, unknown>;
  createdAt: Date;
}

export async function findPendingJobs(
  limit = 10,
): Promise<PendingJobRecord[]> {
  const result = await db.query<{
    job_id: string;
    name: string;
    job_type: PendingJobRecord["jobType"];
    status: "pending";
    model_name: string;
    dataset_name: string | null;
    config: Record<string, unknown>;
    created_at: Date;
  }>(
    `
      SELECT
        job_id,
        name,
        job_type,
        status,
        model_name,
        dataset_name,
        config,
        created_at
      FROM jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT $1
    `,
    [limit],
  );

  return result.rows.map((row) => ({
    jobId: row.job_id,
    name: row.name,
    jobType: row.job_type,
    status: row.status,
    modelName: row.model_name,
    datasetName: row.dataset_name,
    config: row.config,
    createdAt: row.created_at,
  }));
}

export async function countTasksForJob(
  jobId: string,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM tasks
      WHERE job_id = $1
    `,
    [jobId],
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function createJobTasks(
  jobId: string,
  tasks: Array<{
    taskId: string;
    taskType:
      | "training"
      | "inference"
      | "evaluation"
      | "aggregation";
    payload: Record<string, unknown>;
    maxAttempts: number;
  }>,
): Promise<void> {
  if (tasks.length === 0) {
    return;
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    for (const task of tasks) {
      await client.query(
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
            $3,
            $4,
            $5
          )
        `,
        [
          task.taskId,
          jobId,
          task.taskType,
          task.payload,
          task.maxAttempts,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markJobRunning(
  jobId: string,
): Promise<boolean> {
  const result = await db.query(
    `
      UPDATE jobs
      SET
        status = 'running',
        started_at = COALESCE(started_at, NOW()),
        updated_at = NOW()
      WHERE
        job_id = $1
        AND status = 'pending'
    `,
    [jobId],
  );

  return result.rowCount === 1;
}