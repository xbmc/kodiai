CREATE TABLE review_cache_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  pr_number INTEGER,
  cache_surface TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  fingerprint_version TEXT,
  safety_signal_names TEXT[] NOT NULL DEFAULT '{}',
  missing_signal_names TEXT[] NOT NULL DEFAULT '{}',
  invalidation_signal_names TEXT[] NOT NULL DEFAULT '{}',
  bookkeeping_error_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT review_cache_events_surface_check CHECK (cache_surface IN ('review-derived-prompt', 'retrieval-query-embedding')),
  CONSTRAINT review_cache_events_status_check CHECK (status IN ('hit', 'miss', 'degraded', 'bypass')),
  CONSTRAINT review_cache_events_reason_check CHECK (reason IS NULL OR reason IN ('safe-reuse', 'cache-miss', 'bookkeeping-failure', 'incomplete-fingerprint', 'expired-stale-entry', 'disabled-cache', 'unavailable-retrieval')),
  CONSTRAINT review_cache_events_bookkeeping_count_check CHECK (bookkeeping_error_count >= 0)
);

CREATE INDEX idx_review_cache_events_delivery
  ON review_cache_events (delivery_id);

CREATE INDEX idx_review_cache_events_repo_pr_created
  ON review_cache_events (repo, pr_number, created_at);

CREATE INDEX idx_review_cache_events_surface_status_created
  ON review_cache_events (cache_surface, status, created_at);

CREATE INDEX idx_review_cache_events_created_at
  ON review_cache_events (created_at);
