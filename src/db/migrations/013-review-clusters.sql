-- 013-review-clusters.sql
-- Schema for review pattern clustering: clusters, assignments, and pipeline run state.

-- ============================================================================
-- review_clusters: stores discovered review pattern clusters with centroids
-- ============================================================================

CREATE TABLE IF NOT EXISTS review_clusters (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Scope
  repo TEXT NOT NULL,

  -- Labels (two-layer: slug for storage/filtering, label for display)
  slug TEXT NOT NULL,
  label TEXT NOT NULL,

  -- Centroid embedding (mean of member embeddings, 1024-dim voyage-code-3)
  centroid vector(1024),

  -- Membership tracking
  member_count INTEGER NOT NULL DEFAULT 0,
  member_count_at_label INTEGER NOT NULL DEFAULT 0,
  file_paths TEXT[] NOT NULL DEFAULT '{}',

  -- Label lifecycle
  label_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pinned BOOLEAN NOT NULL DEFAULT false,

  -- Retirement (below surfacing threshold)
  retired BOOLEAN NOT NULL DEFAULT false,

  UNIQUE(repo, slug)
);

CREATE INDEX IF NOT EXISTS idx_review_clusters_repo
  ON review_clusters (repo);

CREATE INDEX IF NOT EXISTS idx_review_clusters_active
  ON review_clusters (repo) WHERE retired = false;

-- ============================================================================
-- review_cluster_assignments: maps review comments to clusters
-- ============================================================================

CREATE TABLE IF NOT EXISTS review_cluster_assignments (
  id BIGSERIAL PRIMARY KEY,
  cluster_id BIGINT NOT NULL REFERENCES review_clusters(id) ON DELETE CASCADE,
  review_comment_id BIGINT NOT NULL REFERENCES review_comments(id) ON DELETE CASCADE,
  probability REAL NOT NULL DEFAULT 0,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(cluster_id, review_comment_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_assignments_cluster
  ON review_cluster_assignments (cluster_id);

CREATE INDEX IF NOT EXISTS idx_cluster_assignments_comment
  ON review_cluster_assignments (review_comment_id);

-- ============================================================================
-- cluster_run_state: singleton row tracking pipeline execution
-- ============================================================================

CREATE TABLE IF NOT EXISTS cluster_run_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_run_at TIMESTAMPTZ,
  clusters_discovered INTEGER NOT NULL DEFAULT 0,
  comments_processed INTEGER NOT NULL DEFAULT 0,
  labels_generated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
