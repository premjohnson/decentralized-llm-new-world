ALTER TABLE artifacts
ADD COLUMN sample_count INTEGER;

UPDATE artifacts
SET sample_count = 1
WHERE artifact_type = 'lora_adapter'
  AND sample_count IS NULL;

ALTER TABLE artifacts
ALTER COLUMN sample_count SET DEFAULT 1;

ALTER TABLE artifacts
ADD CONSTRAINT artifacts_sample_count_positive
CHECK (sample_count IS NULL OR sample_count > 0);