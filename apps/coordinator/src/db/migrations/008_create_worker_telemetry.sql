CREATE TABLE worker_telemetry (
    worker_id VARCHAR(100) PRIMARY KEY
        REFERENCES workers(worker_id) ON DELETE CASCADE,

    cpu_usage_percent DOUBLE PRECISION
        CHECK (
            cpu_usage_percent IS NULL
            OR cpu_usage_percent BETWEEN 0 AND 100
        ),

    memory_used_mb BIGINT
        CHECK (memory_used_mb IS NULL OR memory_used_mb >= 0),

    memory_total_mb BIGINT
        CHECK (memory_total_mb IS NULL OR memory_total_mb > 0),

    gpu_utilization_percent DOUBLE PRECISION
        CHECK (
            gpu_utilization_percent IS NULL
            OR gpu_utilization_percent BETWEEN 0 AND 100
        ),

    gpu_memory_used_mb BIGINT
        CHECK (gpu_memory_used_mb IS NULL OR gpu_memory_used_mb >= 0),

    gpu_memory_total_mb BIGINT
        CHECK (gpu_memory_total_mb IS NULL OR gpu_memory_total_mb > 0),

    collected_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        memory_used_mb IS NULL
        OR memory_total_mb IS NULL
        OR memory_used_mb <= memory_total_mb
    ),

    CHECK (
        gpu_memory_used_mb IS NULL
        OR gpu_memory_total_mb IS NULL
        OR gpu_memory_used_mb <= gpu_memory_total_mb
    )
);

CREATE INDEX idx_worker_telemetry_received_at
    ON worker_telemetry(received_at);
