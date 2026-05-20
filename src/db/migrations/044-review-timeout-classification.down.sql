ALTER TABLE resilience_events
  DROP COLUMN IF EXISTS timeout_classification_reasons,
  DROP COLUMN IF EXISTS timeout_classification_mode,
  DROP COLUMN IF EXISTS timeout_classification;
