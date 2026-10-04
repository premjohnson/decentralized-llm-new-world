import { db } from "../src/db/pool.js";
import type {
  TaskRecord,
  TaskStatus,
} from "../src/modules/jobs/task.repository.js";

interface TaskRow {
  task_id: string;
  job_id: string;
  worker_id: string | null;
  task_type: TaskRecord["taskType"];
  status: TaskStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  attempt: number;
  max_attempts: number;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  assigned_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
}

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    taskId: row.task_id,
    jobId: row.job_id,
    workerId: row.worker_id,
    taskType: row.task_type,
    status: row.status,
    payload: row.payload,
    result: row.result,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedAt: row.assigned_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
  };
}

export interface RecoverTimedOutTasksResult {
  recoveredTasks: TaskRecord[];
  requeuedCount: number;
  failedCount: number;
}

export async function recoverTimedOutTasks(
  timeoutSeconds: number,
): Promise<RecoverTimedOutTasksResult> {
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds <= 0
  ) {
    throw new Error(
      "Task timeout must be a positive integer",
    );
  }

  const result = await db.query<TaskRow>(
    `
      UPDATE tasks
      SET
        status = CASE
          WHEN attempt < max_attempts THEN 'pending'
          ELSE 'failed'
        END,

        worker_id = NULL,

        assigned_at = CASE
          WHEN attempt < max_attempts THEN NULL
          ELSE assigned_at
        END,

        started_at = CASE
          WHEN attempt < max_attempts THEN NULL
          ELSE started_at
        END,

        error_message = CASE
          WHEN attempt < max_attempts THEN
            CONCAT(
              'Task timed out after ',
              $1,
              ' seconds and was requeued'
            )
          ELSE
            CONCAT(
              'Task timed out after ',
              $1,
              ' seconds and reached max attempts'
            )
        END,

        failed_at = CASE
          WHEN attempt >= max_attempts THEN NOW()
          ELSE failed_at
        END,

        updated_at = NOW()

      WHERE
        status IN ('assigned', 'running')
        AND COALESCE(
          started_at,
          assigned_at,
          created_at
        ) < NOW() - make_interval(secs => $1)

      RETURNING
        task_id,
        job_id,
        worker_id,
        task_type,
        status,
        payload,
        result,
        attempt,
        max_attempts,
        error_message,
        created_at,
        updated_at,
        assigned_at,
        started_at,
        completed_at,
        failed_at
    `,
    [timeoutSeconds],
  );

  const recoveredTasks = result.rows.map(mapTaskRow);

  const requeuedCount = recoveredTasks.filter(
    (task) => task.status === "pending",
  ).length;

  const failedCount = recoveredTasks.filter(
    (task) => task.status === "failed",
  ).length;

  return {
    recoveredTasks,
    requeuedCount,
    failedCount,
  };
}