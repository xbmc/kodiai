-- 018-triage-threshold-state.sql
-- Per-repo Bayesian state for duplicate detection threshold learning (LEARN-01)

CREATE TABLE IF NOT EXISTS triage_threshold_state (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,

  -- Beta-Binomial parameters (uniform prior: alpha=1, beta=1)
  alpha DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  beta_ DOUBLE PRECISION NOT NULL DEFAULT 1.0,

  -- Bookkeeping
  sample_count INTEGER NOT NULL DEFAULT 0,

  UNIQUE(repo)
);

CREATE INDEX IF NOT EXISTS idx_triage_threshold_state_repo
  ON triage_threshold_state (repo);
