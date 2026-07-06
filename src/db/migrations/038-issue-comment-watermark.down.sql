ALTER TABLE issue_sync_state
  DROP COLUMN IF EXISTS comment_last_synced_at;
