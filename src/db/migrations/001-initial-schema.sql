-- 001-initial-schema.sql
-- Unified PostgreSQL schema consolidating knowledge, telemetry, and learning stores.

-- Migration tracking table
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- Knowledge store tables (from src/knowledge/store.ts)
-- ============================================================================

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  head_sha TEXT,
  delivery_id TEXT,
  files_analyzed INTEGER NOT NULL DEFAULT 0,
  lines_changed INTEGER NOT NULL DEFAULT 0,
  findings_critical INTEGER NOT NULL DEFAULT 0,
  findings_major INTEGER NOT NULL DEFAULT 0,
  findings_medium INTEGER NOT NULL DEFAULT 0,
  findings_minor INTEGER NOT NULL DEFAULT 0,
  findings_total INTEGER NOT NULL DEFAULT 0,
  suppressions_applied INTEGER NOT NULL DEFAULT 0,
  config_snapshot TEXT,
  duration_ms INTEGER,
  model TEXT,
  conclusion TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS idx_reviews_repo ON reviews(repo);
CREATE INDEX IF NOT EXISTS idx_reviews_repo_created ON reviews(repo, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_pr ON reviews(repo, pr_number);

CREATE TABLE IF NOT EXISTS findings (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  title TEXT NOT NULL,
  suppressed BOOLEAN NOT NULL DEFAULT false,
  suppression_pattern TEXT,
  comment_id INTEGER,
  comment_surface TEXT,
  review_output_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_repo_file ON findings(file_path);

CREATE TABLE IF NOT EXISTS suppression_log (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews(id),
  pattern TEXT NOT NULL,
  matched_count INTEGER NOT NULL DEFAULT 0,
  finding_ids TEXT
);

CREATE INDEX IF NOT EXISTS idx_suppression_log_review ON suppression_log(review_id);

CREATE TABLE IF NOT EXISTS global_patterns (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  confidence_band TEXT NOT NULL,
  pattern_fingerprint TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(severity, category, confidence_band, pattern_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_global_patterns_lookup ON global_patterns(severity, category, confidence_band);

CREATE TABLE IF NOT EXISTS feedback_reactions (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  repo TEXT NOT NULL,
  review_id INTEGER NOT NULL REFERENCES reviews(id),
  finding_id INTEGER NOT NULL REFERENCES findings(id),
  comment_id INTEGER NOT NULL,
  comment_surface TEXT NOT NULL,
  reaction_id INTEGER NOT NULL,
  reaction_content TEXT NOT NULL,
  reactor_login TEXT NOT NULL,
  reacted_at TIMESTAMPTZ,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  file_path TEXT NOT NULL,
  title TEXT NOT NULL,
  UNIQUE(repo, comment_id, reaction_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_reactions_repo_created ON feedback_reactions(repo, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_reactions_finding ON feedback_reactions(finding_id);
CREATE INDEX IF NOT EXISTS idx_feedback_reactions_repo_title ON feedback_reactions(repo, title);

CREATE TABLE IF NOT EXISTS run_state (
  id SERIAL PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  superseded_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_state_repo_pr ON run_state(repo, pr_number);
CREATE INDEX IF NOT EXISTS idx_run_state_status ON run_state(status);

CREATE TABLE IF NOT EXISTS author_cache (
  id SERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  author_login TEXT NOT NULL,
  tier TEXT NOT NULL,
  author_association TEXT NOT NULL,
  pr_count INTEGER,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo, author_login)
);

CREATE INDEX IF NOT EXISTS idx_author_cache_lookup ON author_cache(repo, author_login);

CREATE TABLE IF NOT EXISTS dep_bump_merge_history (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  merged_at TIMESTAMPTZ,
  delivery_id TEXT,
  source TEXT,
  signals_json TEXT,
  package_name TEXT,
  old_version TEXT,
  new_version TEXT,
  semver_bump_type TEXT,
  merge_confidence_level TEXT,
  merge_confidence_rationale_json TEXT,
  advisory_status TEXT,
  advisory_max_severity TEXT,
  is_security_bump BOOLEAN,
  UNIQUE(repo, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_dep_bump_merge_repo_created ON dep_bump_merge_history(repo, created_at);
CREATE INDEX IF NOT EXISTS idx_dep_bump_merge_repo_pkg ON dep_bump_merge_history(repo, package_name);

CREATE TABLE IF NOT EXISTS review_checkpoints (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  review_output_key TEXT NOT NULL UNIQUE,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  checkpoint_data TEXT NOT NULL,
  partial_comment_id INTEGER
);

-- ============================================================================
-- Telemetry store tables (from src/telemetry/store.ts)
-- ============================================================================

CREATE TABLE IF NOT EXISTS telemetry_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_id TEXT,
  repo TEXT NOT NULL,
  pr_number INTEGER,
  pr_author TEXT,
  event_type TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'anthropic',
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  conclusion TEXT NOT NULL,
  session_id TEXT,
  num_turns INTEGER,
  stop_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_created_at ON telemetry_events(created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_repo ON telemetry_events(repo);

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_id TEXT,
  repo TEXT NOT NULL,
  pr_number INTEGER,
  event_type TEXT NOT NULL,
  cache_hit_rate REAL NOT NULL,
  skipped_queries INTEGER NOT NULL,
  retry_attempts INTEGER NOT NULL,
  degradation_path TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_events_delivery_event
  ON rate_limit_events(delivery_id, event_type)
  WHERE delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_repo_created
  ON rate_limit_events(repo, created_at);

CREATE TABLE IF NOT EXISTS retrieval_quality_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_id TEXT,
  repo TEXT NOT NULL,
  pr_number INTEGER,
  event_type TEXT NOT NULL,
  top_k INTEGER,
  distance_threshold REAL,
  result_count INTEGER NOT NULL,
  avg_distance REAL,
  language_match_ratio REAL,
  threshold_method TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_retrieval_quality_delivery
  ON retrieval_quality_events(delivery_id)
  WHERE delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retrieval_quality_repo_created
  ON retrieval_quality_events(repo, created_at);

CREATE TABLE IF NOT EXISTS resilience_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_id TEXT NOT NULL UNIQUE,
  repo TEXT NOT NULL,
  pr_number INTEGER,
  pr_author TEXT,
  event_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_delivery_id TEXT,
  review_output_key TEXT,
  execution_conclusion TEXT,
  had_inline_output BOOLEAN,
  checkpoint_files_reviewed INTEGER,
  checkpoint_finding_count INTEGER,
  checkpoint_total_files INTEGER,
  partial_comment_id INTEGER,
  recent_timeouts INTEGER,
  chronic_timeout BOOLEAN,
  retry_enqueued BOOLEAN,
  retry_files_count INTEGER,
  retry_scope_ratio REAL,
  retry_timeout_seconds INTEGER,
  retry_risk_level TEXT,
  retry_checkpoint_enabled BOOLEAN,
  retry_has_results BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_resilience_events_repo_created
  ON resilience_events(repo, created_at);

-- ============================================================================
-- Learning memory tables (from src/learning/memory-store.ts)
-- ============================================================================

CREATE TABLE IF NOT EXISTS learning_memories (
  id BIGSERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  owner TEXT NOT NULL,
  finding_id INTEGER,
  review_id INTEGER,
  source_repo TEXT NOT NULL,
  finding_text TEXT NOT NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  file_path TEXT NOT NULL,
  outcome TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  embedding vector(1024),
  stale BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo, finding_id, outcome)
);

CREATE INDEX IF NOT EXISTS idx_memories_repo ON learning_memories(repo);
CREATE INDEX IF NOT EXISTS idx_memories_owner ON learning_memories(owner);
CREATE INDEX IF NOT EXISTS idx_memories_stale ON learning_memories(stale);
