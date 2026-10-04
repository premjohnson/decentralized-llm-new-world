CREATE TABLE artifacts (
    artifact_id UUID PRIMARY KEY,

    task_id UUID NOT NULL
        REFERENCES tasks(task_id)
        ON DELETE CASCADE,

    job_id UUID NOT NULL
        REFERENCES jobs(job_id)
        ON DELETE CASCADE,

    worker_id VARCHAR(100)
        REFERENCES workers(worker_id)
        ON DELETE SET NULL,

    artifact_type VARCHAR(50) NOT NULL
        CHECK (artifact_type IN (
            'lora_adapter',
            'model_checkpoint',
            'evaluation_result'
        )),

    storage_uri TEXT NOT NULL,

    sha256 CHAR(64) NOT NULL,

    size_bytes BIGINT NOT NULL
        CHECK (size_bytes >= 0),

    model_name VARCHAR(255) NOT NULL,

    format VARCHAR(50) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (task_id, artifact_type)
);

CREATE INDEX idx_artifacts_task_id
    ON artifacts(task_id);

CREATE INDEX idx_artifacts_job_id
    ON artifacts(job_id);

CREATE INDEX idx_artifacts_worker_id
    ON artifacts(worker_id);

CREATE INDEX idx_artifacts_created_at
    ON artifacts(created_at);

CREATE INDEX idx_artifacts_sha256
    ON artifacts(sha256);