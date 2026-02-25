-- 006-wiki-pages.sql
-- Schema for MediaWiki content ingestion: wiki_pages table and sync state.

-- ============================================================================
-- wiki_pages: stores chunked wiki page sections with vector embeddings
-- ============================================================================

CREATE TABLE IF NOT EXISTS wiki_pages (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Page identity
  page_id INTEGER NOT NULL,
  page_title TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL,

  -- Section metadata
  section_heading TEXT,
  section_anchor TEXT,
  section_level INTEGER,

  -- Content
  chunk_index INTEGER NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  token_count INTEGER NOT NULL,

  -- Embedding
  embedding vector(1024),
  embedding_model TEXT,
  stale BOOLEAN NOT NULL DEFAULT false,

  -- Freshness
  last_modified TIMESTAMPTZ,
  revision_id INTEGER,

  -- Lifecycle
  deleted BOOLEAN NOT NULL DEFAULT false
);

-- Unique constraint using expression (COALESCE not allowed in inline UNIQUE constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_pages_unique_chunk
  ON wiki_pages (page_id, COALESCE(section_anchor, ''), chunk_index);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_wiki_pages_page_id
  ON wiki_pages (page_id);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_namespace
  ON wiki_pages (namespace);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_title
  ON wiki_pages (page_title);

-- HNSW index for cosine similarity search (same tuning as learning_memories and review_comments)
CREATE INDEX IF NOT EXISTS idx_wiki_pages_embedding_hnsw
  ON wiki_pages USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Partial index for active (non-stale) records
CREATE INDEX IF NOT EXISTS idx_wiki_pages_stale
  ON wiki_pages (stale) WHERE stale = false;

-- tsvector GIN index for full-text search on chunk_text
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE INDEX IF NOT EXISTS idx_wiki_pages_search_tsv
  ON wiki_pages USING gin (search_tsv);

CREATE OR REPLACE FUNCTION wiki_pages_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', COALESCE(NEW.chunk_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wiki_pages_search_tsv ON wiki_pages;
CREATE TRIGGER trg_wiki_pages_search_tsv
  BEFORE INSERT OR UPDATE OF chunk_text ON wiki_pages
  FOR EACH ROW
  EXECUTE FUNCTION wiki_pages_search_tsv_update();

-- ============================================================================
-- wiki_sync_state: tracking sync progress for backfill and incremental sync
-- ============================================================================

CREATE TABLE IF NOT EXISTS wiki_sync_state (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL UNIQUE,
  last_synced_at TIMESTAMPTZ,
  last_continue_token TEXT,
  total_pages_synced INTEGER NOT NULL DEFAULT 0,
  backfill_complete BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
