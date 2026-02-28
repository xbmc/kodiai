-- 017-issue-outcome-feedback.sql
-- Outcome feedback table for issue closure events + comment_github_id for reaction tracking.

-- Add comment_github_id to issue_triage_state for reaction tracking (REACT-01)
ALTER TABLE issue_triage_state
  ADD COLUMN IF NOT EXISTS comment_github_id BIGINT;

-- Outcome feedback table for issue closure events
CREATE TABLE IF NOT EXISTS issue_outcome_feedback (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,

  -- Link to triage record (NULL if never triaged)
  triage_id BIGINT REFERENCES issue_triage_state(id) ON DELETE SET NULL,

  -- Outcome classification
  outcome TEXT NOT NULL,  -- "duplicate" | "completed" | "not_planned" | "unknown"
  kodiai_predicted_duplicate BOOLEAN NOT NULL DEFAULT false,
  confirmed_duplicate BOOLEAN NOT NULL DEFAULT false,
  duplicate_of_issue_number INTEGER,

  -- Raw signals
  state_reason TEXT,
  label_names TEXT[] NOT NULL DEFAULT '{}',

  -- Idempotency
  delivery_id TEXT NOT NULL,

  UNIQUE(repo, issue_number),
  UNIQUE(delivery_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_outcome_feedback_repo
  ON issue_outcome_feedback (repo);

CREATE INDEX IF NOT EXISTS idx_issue_outcome_feedback_triage
  ON issue_outcome_feedback (triage_id)
  WHERE triage_id IS NOT NULL;
