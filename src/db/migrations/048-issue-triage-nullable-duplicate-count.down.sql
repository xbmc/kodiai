UPDATE issue_triage_state
SET duplicate_count = 0
WHERE duplicate_count IS NULL;

ALTER TABLE issue_triage_state
  ALTER COLUMN duplicate_count SET DEFAULT 0,
  ALTER COLUMN duplicate_count SET NOT NULL;
