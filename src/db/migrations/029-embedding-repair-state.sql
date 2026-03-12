-- 029-embedding-repair-state.sql
-- Generic durable checkpoint state for non-wiki embedding repair runs.

CREATE TABLE IF NOT EXISTS embedding_repair_state (
  id SERIAL PRIMARY KEY,
  corpus TEXT NOT NULL,
  repair_key TEXT NOT NULL DEFAULT 'default',
  run_id TEXT NOT NULL,
  target_model TEXT,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  resumed BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'running',
  resume_ready BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  batch_index INTEGER,
  batches_total INTEGER,
  last_row_id BIGINT,

  processed INTEGER NOT NULL DEFAULT 0,
  repaired INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,

  failure_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_failure_class TEXT,
  last_failure_message TEXT,

  UNIQUE (corpus, repair_key)
);

CREATE INDEX IF NOT EXISTS idx_embedding_repair_state_updated_at
  ON embedding_repair_state (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_embedding_repair_state_corpus_status
  ON embedding_repair_state (corpus, status, updated_at DESC);
