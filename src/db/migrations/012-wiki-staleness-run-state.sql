-- Migration 012: Wiki staleness run state tracking
-- Tracks scan window anchor and run status to prevent duplicate scans and enable gap-free scanning.

CREATE TABLE wiki_staleness_run_state (
  id              SERIAL PRIMARY KEY,
  last_run_at     TIMESTAMPTZ,
  last_commit_sha TEXT,
  pages_flagged   INTEGER NOT NULL DEFAULT 0,
  pages_evaluated INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  error_message   TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row table: always upsert into id=1.
-- status values: 'success' | 'failed' | 'pending'
