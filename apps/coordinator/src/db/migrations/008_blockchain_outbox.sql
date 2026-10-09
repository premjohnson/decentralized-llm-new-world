CREATE TABLE blockchain_outbox (
    outbox_id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,

    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'REGISTER_JOB',
            'UPDATE_STATUS',
            'RECORD_ROUND'
        )
    ),

    payload JSONB NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'processing',
            'completed',
            'failed'
        )
    ),

    idempotency_key TEXT NOT NULL UNIQUE,

    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),

    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    locked_at TIMESTAMPTZ,

    completed_at TIMESTAMPTZ,

    last_error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blockchain_outbox_pending
    ON blockchain_outbox (available_at, created_at)
    WHERE status = 'pending';

CREATE INDEX idx_blockchain_outbox_processing
    ON blockchain_outbox (locked_at)
    WHERE status = 'processing';

CREATE INDEX idx_blockchain_outbox_job
    ON blockchain_outbox (job_id);

CREATE INDEX idx_blockchain_outbox_status
    ON blockchain_outbox (status);
