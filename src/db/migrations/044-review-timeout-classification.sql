ALTER TABLE resilience_events
  ADD COLUMN IF NOT EXISTS timeout_classification TEXT,
  ADD COLUMN IF NOT EXISTS timeout_classification_mode TEXT,
  ADD COLUMN IF NOT EXISTS timeout_classification_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
