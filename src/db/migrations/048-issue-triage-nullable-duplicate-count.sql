ALTER TABLE issue_triage_state
  ALTER COLUMN duplicate_count DROP NOT NULL,
  ALTER COLUMN duplicate_count DROP DEFAULT;
