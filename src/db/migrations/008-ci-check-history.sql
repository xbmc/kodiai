CREATE TABLE IF NOT EXISTS ci_check_history (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  repo TEXT NOT NULL,
  check_name TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  conclusion TEXT NOT NULL,
  check_suite_id BIGINT,
  pr_number INTEGER
);

CREATE INDEX idx_ci_check_history_repo_name
  ON ci_check_history(repo, check_name, created_at DESC);
