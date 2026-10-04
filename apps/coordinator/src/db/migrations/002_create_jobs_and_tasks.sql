CREATE TABLE jobs (
    job_id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    job_type VARCHAR(50) NOT NULL
        CHECK (job_type IN ('training', 'inference', 'evaluation')),
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'running',
                'completed',
                'failed',
                'cancelled'
            )
        ),
    model_name VARCHAR(255) NOT NULL,
    dataset_name VARCHAR(255),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_jobs_status
    ON jobs(status);

CREATE INDEX idx_jobs_created_at
    ON jobs(created_at);


CREATE TABLE tasks (
    task_id UUID PRIMARY KEY,

    job_id UUID NOT NULL
        REFERENCES jobs(job_id)
        ON DELETE CASCADE,

    worker_id VARCHAR(100)
        REFERENCES workers(worker_id)
        ON DELETE SET NULL,

    task_type VARCHAR(50) NOT NULL
        CHECK (
            task_type IN (
                'training',
                'inference',
                'evaluation',
                'aggregation'
            )
        ),

    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'assigned',
                'running',
                'completed',
                'failed',
                'retrying',
                'cancelled'
            )
        ),

    payload JSONB NOT NULL DEFAULT '{}'::jsonb,

    attempt INTEGER NOT NULL DEFAULT 0
        CHECK (attempt >= 0),

    max_attempts INTEGER NOT NULL DEFAULT 3
        CHECK (max_attempts > 0),

    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ
);

CREATE INDEX idx_tasks_job_id
    ON tasks(job_id);

CREATE INDEX idx_tasks_status
    ON tasks(status);

CREATE INDEX idx_tasks_worker_id
    ON tasks(worker_id);

CREATE INDEX idx_tasks_created_at
    ON tasks(created_at);

CREATE INDEX idx_tasks_pending
    ON tasks(created_at)
    WHERE status = 'pending';