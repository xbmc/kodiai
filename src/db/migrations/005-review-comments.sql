-- 005-review-comments.sql
-- Schema for PR review comment ingestion: review_comments table and sync state.

-- ============================================================================
-- review_comments: stores chunked PR review comments with vector embeddings
-- ============================================================================

CREATE TABLE IF NOT EXISTS review_comments (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Source identity
  repo TEXT NOT NULL,
  owner TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_title TEXT,
  comment_github_id BIGINT NOT NULL,

  -- Thread grouping
  thread_id TEXT NOT NULL,
  in_reply_to_id BIGINT,

  -- Location metadata
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  diff_hunk TEXT,

  -- Author metadata
  author_login TEXT NOT NULL,
  author_association TEXT,

  -- Content
  body TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  token_count INTEGER NOT NULL,

  -- Embedding
  embedding vector(1024),
  embedding_model TEXT,
  stale BOOLEAN NOT NULL DEFAULT false,

  -- Lifecycle
  github_created_at TIMESTAMPTZ NOT NULL,
  github_updated_at TIMESTAMPTZ,
  deleted BOOLEAN NOT NULL DEFAULT false,

  -- Sync tracking
  backfill_batch TEXT,

  UNIQUE(repo, comment_github_id, chunk_index)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_review_comments_repo
  ON review_comments (repo);

CREATE INDEX IF NOT EXISTS idx_review_comments_thread
  ON review_comments (thread_id);

CREATE INDEX IF NOT EXISTS idx_review_comments_pr
  ON review_comments (repo, pr_number);

CREATE INDEX IF NOT EXISTS idx_review_comments_author
  ON review_comments (author_login);

CREATE INDEX IF NOT EXISTS idx_review_comments_github_id
  ON review_comments (repo, comment_github_id);

-- HNSW index for cosine similarity search (same tuning as learning_memories)
CREATE INDEX IF NOT EXISTS idx_review_comments_embedding_hnsw
  ON review_comments USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Partial index for active (non-stale) records
CREATE INDEX IF NOT EXISTS idx_review_comments_stale
  ON review_comments (stale) WHERE stale = false;

-- tsvector GIN index for full-text search on chunk_text
ALTER TABLE review_comments ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE INDEX IF NOT EXISTS idx_review_comments_search_tsv
  ON review_comments USING gin (search_tsv);

CREATE OR REPLACE FUNCTION review_comments_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', COALESCE(NEW.chunk_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_comments_search_tsv ON review_comments;
CREATE TRIGGER trg_review_comments_search_tsv
  BEFORE INSERT OR UPDATE OF chunk_text ON review_comments
  FOR EACH ROW
  EXECUTE FUNCTION review_comments_search_tsv_update();

-- ============================================================================
-- review_comment_sync_state: cursor-based resume for backfill/incremental sync
-- ============================================================================

CREATE TABLE IF NOT EXISTS review_comment_sync_state (
  id SERIAL PRIMARY KEY,
  repo TEXT NOT NULL UNIQUE,
  last_synced_at TIMESTAMPTZ,
  last_page_cursor TEXT,
  total_comments_synced INTEGER NOT NULL DEFAULT 0,
  backfill_complete BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
