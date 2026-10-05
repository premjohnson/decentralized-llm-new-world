CREATE TABLE model_registry (
    model_id UUID PRIMARY KEY,

    model_name VARCHAR(255) NOT NULL,

    version VARCHAR(100) NOT NULL,

    artifact_id UUID NOT NULL
        REFERENCES artifacts(artifact_id)
        ON DELETE RESTRICT,

    status VARCHAR(30) NOT NULL DEFAULT 'registered'
        CHECK (
            status IN (
                'registered',
                'ready',
                'deprecated',
                'failed'
            )
        ),

    base_model_name VARCHAR(255),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (model_name, version),

    UNIQUE (artifact_id)
);

CREATE INDEX idx_model_registry_name
    ON model_registry(model_name);

CREATE INDEX idx_model_registry_status
    ON model_registry(status);

CREATE INDEX idx_model_registry_name_status
    ON model_registry(model_name, status);

CREATE INDEX idx_model_registry_created_at
    ON model_registry(created_at);
