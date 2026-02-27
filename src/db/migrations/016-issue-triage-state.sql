CREATE TABLE IF NOT EXISTS issue_triage_state (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  triaged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_id TEXT NOT NULL,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(repo, issue_number)
);

CREATE INDEX IF NOT EXISTS idx_issue_triage_state_repo
  ON issue_triage_state (repo, issue_number);
