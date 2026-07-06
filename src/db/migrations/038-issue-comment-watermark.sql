-- 038-issue-comment-watermark.sql
-- Track issue-comment backfill independently from issue backfill so a fresh
-- comment pass does not inherit the issue updated_at watermark.

ALTER TABLE issue_sync_state
  ADD COLUMN IF NOT EXISTS comment_last_synced_at TIMESTAMPTZ;
