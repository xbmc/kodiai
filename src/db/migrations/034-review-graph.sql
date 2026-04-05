-- 034-review-graph.sql
-- Persistent structural graph substrate for review-time blast radius, test mapping,
-- and incremental structural indexing. Tuned for file-scoped replacement so a
-- changed file can be re-indexed atomically without rebuilding the whole graph.

CREATE TABLE IF NOT EXISTS review_graph_builds (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  commit_sha TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,

  files_indexed INTEGER NOT NULL DEFAULT 0,
  files_failed INTEGER NOT NULL DEFAULT 0,
  nodes_written INTEGER NOT NULL DEFAULT 0,
  edges_written INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT review_graph_builds_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  CONSTRAINT review_graph_builds_files_indexed_check
    CHECK (files_indexed >= 0),
  CONSTRAINT review_graph_builds_files_failed_check
    CHECK (files_failed >= 0),
  CONSTRAINT review_graph_builds_nodes_written_check
    CHECK (nodes_written >= 0),
  CONSTRAINT review_graph_builds_edges_written_check
    CHECK (edges_written >= 0),

  UNIQUE (repo, workspace_key)
);

CREATE INDEX IF NOT EXISTS idx_review_graph_builds_repo
  ON review_graph_builds (repo);

CREATE INDEX IF NOT EXISTS idx_review_graph_builds_status
  ON review_graph_builds (status);

CREATE TABLE IF NOT EXISTS review_graph_files (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT NOT NULL,
  content_hash TEXT,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  build_id BIGINT REFERENCES review_graph_builds(id) ON DELETE SET NULL,

  UNIQUE (repo, workspace_key, path)
);

CREATE INDEX IF NOT EXISTS idx_review_graph_files_repo_workspace
  ON review_graph_files (repo, workspace_key);

CREATE INDEX IF NOT EXISTS idx_review_graph_files_repo_path
  ON review_graph_files (repo, path);

CREATE INDEX IF NOT EXISTS idx_review_graph_files_build_id
  ON review_graph_files (build_id);

CREATE TABLE IF NOT EXISTS review_graph_nodes (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  file_id BIGINT NOT NULL REFERENCES review_graph_files(id) ON DELETE CASCADE,
  build_id BIGINT REFERENCES review_graph_builds(id) ON DELETE SET NULL,

  node_kind TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  symbol_name TEXT,
  qualified_name TEXT,
  language TEXT NOT NULL,
  span_start_line INTEGER,
  span_start_col INTEGER,
  span_end_line INTEGER,
  span_end_col INTEGER,
  signature TEXT,
  attributes JSONB NOT NULL DEFAULT '{}',

  confidence REAL,

  CONSTRAINT review_graph_nodes_kind_check
    CHECK (node_kind IN ('file', 'symbol', 'import', 'callsite', 'test')),
  CONSTRAINT review_graph_nodes_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT review_graph_nodes_span_start_line_check
    CHECK (span_start_line IS NULL OR span_start_line >= 1),
  CONSTRAINT review_graph_nodes_span_end_line_check
    CHECK (span_end_line IS NULL OR span_end_line >= 1),

  UNIQUE (repo, workspace_key, stable_key)
);

CREATE INDEX IF NOT EXISTS idx_review_graph_nodes_repo_workspace_kind
  ON review_graph_nodes (repo, workspace_key, node_kind);

CREATE INDEX IF NOT EXISTS idx_review_graph_nodes_file_id
  ON review_graph_nodes (file_id);

CREATE INDEX IF NOT EXISTS idx_review_graph_nodes_symbol_name
  ON review_graph_nodes (repo, symbol_name);

CREATE INDEX IF NOT EXISTS idx_review_graph_nodes_qualified_name
  ON review_graph_nodes (repo, qualified_name);

CREATE TABLE IF NOT EXISTS review_graph_edges (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  file_id BIGINT NOT NULL REFERENCES review_graph_files(id) ON DELETE CASCADE,
  build_id BIGINT REFERENCES review_graph_builds(id) ON DELETE SET NULL,

  edge_kind TEXT NOT NULL,
  source_node_id BIGINT NOT NULL REFERENCES review_graph_nodes(id) ON DELETE CASCADE,
  target_node_id BIGINT NOT NULL REFERENCES review_graph_nodes(id) ON DELETE CASCADE,
  confidence REAL,
  attributes JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT review_graph_edges_kind_check
    CHECK (edge_kind IN ('declares', 'imports', 'includes', 'calls', 'references', 'tests', 'contains')),
  CONSTRAINT review_graph_edges_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT review_graph_edges_no_self_loop_check
    CHECK (source_node_id <> target_node_id),

  UNIQUE (repo, workspace_key, edge_kind, source_node_id, target_node_id)
);

CREATE INDEX IF NOT EXISTS idx_review_graph_edges_repo_workspace_kind
  ON review_graph_edges (repo, workspace_key, edge_kind);

CREATE INDEX IF NOT EXISTS idx_review_graph_edges_source
  ON review_graph_edges (source_node_id, edge_kind);

CREATE INDEX IF NOT EXISTS idx_review_graph_edges_target
  ON review_graph_edges (target_node_id, edge_kind);

CREATE INDEX IF NOT EXISTS idx_review_graph_edges_file_id
  ON review_graph_edges (file_id);
