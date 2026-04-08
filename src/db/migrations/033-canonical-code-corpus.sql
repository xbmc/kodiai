-- 033-canonical-code-corpus.sql
-- Canonical current-code corpus: HEAD snapshot chunks with full provenance.
--
-- This is explicitly SEPARATE from the historical diff-hunk corpus in
-- code_snippets / code_snippet_occurrences (migration 009). The historical
-- corpus records changed hunks tied to PR occurrences. This corpus records
-- the canonical state of current code at a specific ref/commit.
--
-- Design notes:
--   * chunk_identity  – stable logical key: (repo, canonical_ref, file_path,
--                       symbol_name, chunk_type). Used to locate the row to
--                       replace when a file changes.
--   * content_hash    – SHA-256 of chunk content; guards against re-embedding
--                       unchanged text.
--   * canonical_ref   – human-readable ref ("main", "master", "develop").
--   * commit_sha      – the actual commit at the time of embedding; truthful
--                       provenance for cache-busting and audit.
--   * Stale semantics – `stale=true` means the row exists but its embedding
--                       should be recalculated (model drift or data change).
--   * Deleted        – `deleted_at` soft-delete lets audit/repair detect rows
--                       that no longer correspond to live files without
--                       destroying history.

-- ============================================================================
-- canonical_code_chunks: one row per unique chunk at a specific ref/commit
-- ============================================================================

CREATE TABLE IF NOT EXISTS canonical_code_chunks (
  id BIGSERIAL PRIMARY KEY,

  -- Repo identity
  repo          TEXT NOT NULL,
  owner         TEXT NOT NULL,
  canonical_ref TEXT NOT NULL,   -- e.g. "main", "master"
  commit_sha    TEXT NOT NULL,   -- actual commit hash at embed time

  -- File / chunk location
  file_path     TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'unknown',
  start_line    INTEGER NOT NULL,
  end_line      INTEGER NOT NULL,

  -- Chunk identity and type
  -- chunk_type: 'function' | 'class' | 'method' | 'module' | 'block'
  chunk_type    TEXT NOT NULL DEFAULT 'block'
                CHECK (chunk_type IN ('function', 'class', 'method', 'module', 'block')),
  -- symbol_name: fully-qualified symbol name when available, NULL for
  -- fallback block chunks (e.g. fixed-size splits of symbol-poor files)
  symbol_name   TEXT,

  -- Content
  chunk_text    TEXT NOT NULL,
  content_hash  TEXT NOT NULL,   -- SHA-256 of chunk_text

  -- Embedding
  embedding           vector(1024),
  embedding_model     TEXT,

  -- Full-text search
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,

  -- Audit / lifecycle
  stale         BOOLEAN NOT NULL DEFAULT false,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Chunk identity uniqueness ─────────────────────────────────────────────
-- One active (non-deleted) chunk per logical identity per ref.
-- symbol_name IS NULL is handled via COALESCE to a sentinel for the unique key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_chunks_identity
  ON canonical_code_chunks (repo, owner, canonical_ref, file_path, chunk_type, COALESCE(symbol_name, ''))
  WHERE deleted_at IS NULL;

-- ── Content-hash lookup (dedup and incremental updates) ───────────────────
CREATE INDEX IF NOT EXISTS idx_canonical_chunks_content_hash
  ON canonical_code_chunks (content_hash);

-- ── Repo + ref queries (backfill, audit, file-level refresh) ─────────────
CREATE INDEX IF NOT EXISTS idx_canonical_chunks_repo_ref
  ON canonical_code_chunks (repo, canonical_ref)
  WHERE deleted_at IS NULL;

-- ── File-level refresh (incremental merge-driven update) ──────────────────
CREATE INDEX IF NOT EXISTS idx_canonical_chunks_file
  ON canonical_code_chunks (repo, canonical_ref, file_path)
  WHERE deleted_at IS NULL;

-- ── Language filter (for language-scoped retrieval) ───────────────────────
CREATE INDEX IF NOT EXISTS idx_canonical_chunks_language
  ON canonical_code_chunks (language)
  WHERE deleted_at IS NULL;

-- ── Full-text search ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_canonical_chunks_tsv
  ON canonical_code_chunks USING gin(tsv);

-- ── HNSW vector index for cosine similarity search ───────────────────────
CREATE INDEX IF NOT EXISTS idx_canonical_chunks_embedding
  ON canonical_code_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Stale row fast-path (repair sweeps) ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_canonical_chunks_stale
  ON canonical_code_chunks (id)
  WHERE stale = true AND deleted_at IS NULL;

-- ============================================================================
-- canonical_corpus_backfill_state: per-repo backfill progress tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS canonical_corpus_backfill_state (
  id            BIGSERIAL PRIMARY KEY,
  repo          TEXT NOT NULL,
  owner         TEXT NOT NULL,
  canonical_ref TEXT NOT NULL,

  -- Backfill run metadata
  run_id        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  -- status values: 'running' | 'completed' | 'failed' | 'partial'

  -- Progress counters
  files_total   INTEGER,
  files_done    INTEGER NOT NULL DEFAULT 0,
  chunks_total  INTEGER,
  chunks_done   INTEGER NOT NULL DEFAULT 0,
  chunks_skipped INTEGER NOT NULL DEFAULT 0,  -- content-hash dedup hits
  chunks_failed INTEGER NOT NULL DEFAULT 0,

  -- Resumability: last file path processed (cursor for restart)
  last_file_path TEXT,
  commit_sha    TEXT,

  error_message TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (repo, owner, canonical_ref)
);

CREATE INDEX IF NOT EXISTS idx_canonical_backfill_repo_ref
  ON canonical_corpus_backfill_state (repo, owner, canonical_ref);
