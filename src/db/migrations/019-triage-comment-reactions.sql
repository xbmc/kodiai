-- 019-triage-comment-reactions.sql
-- Stores reaction snapshots for triage comments to feed secondary signal into threshold learning.

CREATE TABLE IF NOT EXISTS triage_comment_reactions (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  triage_id BIGINT NOT NULL REFERENCES issue_triage_state(id) ON DELETE CASCADE,
  comment_github_id BIGINT NOT NULL,

  thumbs_up INTEGER NOT NULL DEFAULT 0,
  thumbs_down INTEGER NOT NULL DEFAULT 0,

  -- Whether a threshold observation has been recorded from these reactions
  observation_recorded BOOLEAN NOT NULL DEFAULT false,
  -- The net direction when observation was recorded: 'up', 'down', or NULL
  observation_direction TEXT,

  UNIQUE(repo, issue_number)
);

CREATE INDEX IF NOT EXISTS idx_triage_comment_reactions_triage
  ON triage_comment_reactions (triage_id);
