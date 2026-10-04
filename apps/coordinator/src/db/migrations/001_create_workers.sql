CREATE TABLE workers (
    worker_id VARCHAR(100) PRIMARY KEY,
    hostname VARCHAR(255) NOT NULL,

    cpu_cores INTEGER NOT NULL CHECK (cpu_cores > 0),
    memory_mb INTEGER NOT NULL CHECK (memory_mb > 0),

    gpu BOOLEAN NOT NULL DEFAULT FALSE,
    gpu_model VARCHAR(255),
    vram_mb INTEGER CHECK (vram_mb IS NULL OR vram_mb > 0),

    status VARCHAR(20) NOT NULL DEFAULT 'offline'
        CHECK (status IN ('online', 'offline')),

    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workers_status
    ON workers(status);

CREATE INDEX idx_workers_last_heartbeat_at
    ON workers(last_heartbeat_at);
