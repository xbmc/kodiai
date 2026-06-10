CREATE INDEX IF NOT EXISTS idx_telemetry_timeout_repo_author_recent
  ON telemetry_events (repo, pr_author, created_at DESC)
  WHERE conclusion IN ('timeout', 'timeout_partial');

CREATE INDEX IF NOT EXISTS idx_wiki_pr_evidence_page_merged
  ON wiki_pr_evidence (matched_page_id, merged_at DESC);
