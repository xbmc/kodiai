CREATE INDEX IF NOT EXISTS idx_issue_triage_recent_comment_reactions
  ON issue_triage_state (triaged_at DESC, repo, issue_number)
  WHERE comment_github_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_review_comments_null_embedding_repair
  ON review_comments (repo, github_created_at, id)
  WHERE deleted = false AND embedding IS NULL;

CREATE INDEX IF NOT EXISTS idx_llm_cost_events_repo_created
  ON llm_cost_events (repo, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_section_events_repo_created
  ON prompt_section_events (repo, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_cache_events_repo_created
  ON review_cache_events (repo, created_at DESC);
