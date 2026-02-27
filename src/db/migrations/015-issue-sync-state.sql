-- 015-issue-sync-state.sql
-- Cursor-based resume tracking for issue backfill and incremental sync.

CREATE TABLE IF NOT EXISTS issue_sync_state (
  id SERIAL PRIMARY KEY,
  repo TEXT NOT NULL UNIQUE,
  last_synced_at TIMESTAMPTZ,
  last_page_cursor TEXT,
  total_issues_synced INTEGER NOT NULL DEFAULT 0,
  total_comments_synced INTEGER NOT NULL DEFAULT 0,
  backfill_complete BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
