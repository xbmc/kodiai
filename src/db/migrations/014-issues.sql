-- 014-issues.sql
-- Schema for issue corpus: issues table and issue_comments table with vector embeddings.

-- ============================================================================
-- issues: stores GitHub issues with vector embeddings for similarity search
-- ============================================================================

CREATE TABLE IF NOT EXISTS issues (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Source identity
  repo TEXT NOT NULL,
  owner TEXT NOT NULL,
  issue_number INTEGER NOT NULL,

  -- Content
  title TEXT NOT NULL,
  body TEXT,

  -- Issue metadata
  state TEXT NOT NULL DEFAULT 'open',
  author_login TEXT NOT NULL,
  author_association TEXT,
  label_names TEXT[] NOT NULL DEFAULT '{}',
  template_slug TEXT,
  comment_count INTEGER NOT NULL DEFAULT 0,
  assignees JSONB DEFAULT '[]',
  milestone TEXT,
  reaction_count INTEGER NOT NULL DEFAULT 0,
  is_pull_request BOOLEAN NOT NULL DEFAULT false,
  locked BOOLEAN NOT NULL DEFAULT false,

  -- Embedding
  embedding vector(1024),
  embedding_model TEXT,

  -- Full-text search
  search_tsv tsvector,

  -- Lifecycle
  github_created_at TIMESTAMPTZ NOT NULL,
  github_updated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,

  UNIQUE(repo, issue_number)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_issues_repo
  ON issues (repo);

CREATE INDEX IF NOT EXISTS idx_issues_repo_number
  ON issues (repo, issue_number);

CREATE INDEX IF NOT EXISTS idx_issues_state
  ON issues (state);

CREATE INDEX IF NOT EXISTS idx_issues_author
  ON issues (author_login);

CREATE INDEX IF NOT EXISTS idx_issues_labels
  ON issues USING gin (label_names);

-- HNSW index for cosine similarity search (matching existing corpus conventions)
CREATE INDEX IF NOT EXISTS idx_issues_embedding_hnsw
  ON issues USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- tsvector GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_issues_search_tsv
  ON issues USING gin (search_tsv);

-- Trigger: weighted tsvector from title (A) + body (B) + labels (C)
CREATE OR REPLACE FUNCTION issues_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
                    setweight(to_tsvector('english', COALESCE(NEW.body, '')), 'B') ||
                    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.label_names, ' '), '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_issues_search_tsv ON issues;
CREATE TRIGGER trg_issues_search_tsv
  BEFORE INSERT OR UPDATE OF title, body, label_names ON issues
  FOR EACH ROW
  EXECUTE FUNCTION issues_search_tsv_update();

-- ============================================================================
-- issue_comments: stores individual issue comments with vector embeddings
-- ============================================================================

CREATE TABLE IF NOT EXISTS issue_comments (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Source identity
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  comment_github_id BIGINT NOT NULL,

  -- Author metadata
  author_login TEXT NOT NULL,
  author_association TEXT,

  -- Content
  body TEXT NOT NULL,

  -- Embedding
  embedding vector(1024),
  embedding_model TEXT,

  -- Full-text search
  search_tsv tsvector,

  -- Lifecycle
  github_created_at TIMESTAMPTZ NOT NULL,
  github_updated_at TIMESTAMPTZ,

  UNIQUE(repo, comment_github_id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_issue_comments_repo_issue
  ON issue_comments (repo, issue_number);

CREATE INDEX IF NOT EXISTS idx_issue_comments_author
  ON issue_comments (author_login);

-- HNSW index for cosine similarity search
CREATE INDEX IF NOT EXISTS idx_issue_comments_embedding_hnsw
  ON issue_comments USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- tsvector GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_issue_comments_search_tsv
  ON issue_comments USING gin (search_tsv);

-- Trigger: tsvector from comment body
CREATE OR REPLACE FUNCTION issue_comments_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', COALESCE(NEW.body, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_issue_comments_search_tsv ON issue_comments;
CREATE TRIGGER trg_issue_comments_search_tsv
  BEFORE INSERT OR UPDATE OF body ON issue_comments
  FOR EACH ROW
  EXECUTE FUNCTION issue_comments_search_tsv_update();
