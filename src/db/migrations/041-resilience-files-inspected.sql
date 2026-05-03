ALTER TABLE resilience_events
  ADD COLUMN IF NOT EXISTS checkpoint_files_inspected INTEGER;
