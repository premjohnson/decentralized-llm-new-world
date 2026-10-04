CREATE UNIQUE INDEX idx_tasks_one_aggregation_per_job
ON tasks (job_id)
WHERE task_type = 'aggregation';