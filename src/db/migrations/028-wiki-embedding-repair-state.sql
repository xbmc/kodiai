-- 028-wiki-embedding-repair-state.sql
-- Dedicated durable checkpoint state for bounded wiki embedding repair.

CREATE TABLE IF NOT EXISTS wiki_embedding_repair_state (
  id SERIAL PRIMARY KEY,
  repair_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  page_id INTEGER,
  page_title TEXT,
  window_index INTEGER,
  windows_total INTEGER,

  repaired INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  used_split_fallback BOOLEAN NOT NULL DEFAULT false,

  last_failure_class TEXT,
  last_failure_message TEXT,
  last_processed_chunk_ids INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[]
);

CREATE INDEX IF NOT EXISTS idx_wiki_embedding_repair_state_updated_at
  ON wiki_embedding_repair_state (updated_at DESC);
