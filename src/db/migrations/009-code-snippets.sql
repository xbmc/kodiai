-- 009-code-snippets.sql
-- Hunk-level code snippet embedding with content-hash deduplication.
-- One embedding per unique hunk content, junction table for PR/file/line occurrences.

-- ============================================================================
-- code_snippets: one row per unique hunk content (keyed by SHA-256 hash)
-- ============================================================================

CREATE TABLE IF NOT EXISTS code_snippets (
  id SERIAL PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  embedded_text TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'unknown',
  embedding vector(1024),
  embedding_model TEXT,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', embedded_text)) STORED,
  stale BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_code_snippets_hash ON code_snippets(content_hash);
CREATE INDEX IF NOT EXISTS idx_code_snippets_language ON code_snippets(language);
CREATE INDEX IF NOT EXISTS idx_code_snippets_tsv ON code_snippets USING gin(tsv);
CREATE INDEX IF NOT EXISTS idx_code_snippets_embedding ON code_snippets USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- code_snippet_occurrences: junction linking content_hash to PR/file/line
-- ============================================================================

CREATE TABLE IF NOT EXISTS code_snippet_occurrences (
  id SERIAL PRIMARY KEY,
  content_hash TEXT NOT NULL REFERENCES code_snippets(content_hash),
  repo TEXT NOT NULL,
  owner TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_title TEXT,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  function_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snippet_occ_hash ON code_snippet_occurrences(content_hash);
CREATE INDEX IF NOT EXISTS idx_snippet_occ_repo_pr ON code_snippet_occurrences(repo, pr_number);
CREATE INDEX IF NOT EXISTS idx_snippet_occ_repo ON code_snippet_occurrences(repo);
