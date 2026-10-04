import {
  countTasksForJob,
  findPendingJobs,
  markJobRunning,
  type PendingJobRecord,
} from "./scheduler.repository.js";

interface SchedulerResult {
  jobsProcessed: number;
  jobsStarted: number;
  jobsWaitingForTasks: number;
}

interface SchedulerConfig {
  batchSize?: number;
}

async function processPendingJob(
  job: PendingJobRecord,
): Promise<"started" | "waiting"> {
  /*
   * Task creation belongs to JobService.
   *
   * The scheduler only verifies that the job has
   * persisted tasks before moving the job into
   * the running state.
   */
  const taskCount = await countTasksForJob(job.jobId);

  if (taskCount === 0) {
    return "waiting";
  }

  /*
   * Transition the job only after its tasks have
   * been confirmed in PostgreSQL.
   *
   * markJobRunning() is idempotent because it only
   * updates jobs that are still pending.
   */
  const started = await markJobRunning(job.jobId);

  return started ? "started" : "waiting";
}

export async function runSchedulerCycle(
  config: SchedulerConfig = {},
): Promise<SchedulerResult> {
  const batchSize = config.batchSize ?? 10;

  if (
    !Number.isInteger(batchSize) ||
    batchSize <= 0
  ) {
    throw new Error(
      "Scheduler batch size must be a positive integer",
    );
  }

  const jobs = await findPendingJobs(batchSize);

  let jobsStarted = 0;
  let jobsWaitingForTasks = 0;

  for (const job of jobs) {
    const result = await processPendingJob(job);

    if (result === "started") {
      jobsStarted += 1;
    } else {
      jobsWaitingForTasks += 1;
    }
  }

  return {
    jobsProcessed: jobs.length,
    jobsStarted,
    jobsWaitingForTasks,
  };
}
