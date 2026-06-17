CREATE INDEX IF NOT EXISTS idx_learning_memories_embedding_repair_voyage4
  ON learning_memories (id)
  WHERE embedding IS NULL
     OR stale = true
     OR embedding_model IS DISTINCT FROM 'voyage-4';

CREATE INDEX IF NOT EXISTS idx_review_comments_embedding_repair_voyage4
  ON review_comments (id)
  WHERE deleted = false
    AND (
      embedding IS NULL
      OR stale = true
      OR embedding_model IS DISTINCT FROM 'voyage-4'
    );

CREATE INDEX IF NOT EXISTS idx_code_snippets_embedding_repair_voyage4
  ON code_snippets (id)
  WHERE embedded_text IS NOT NULL
    AND (
      embedding IS NULL
      OR stale = true
      OR embedding_model IS DISTINCT FROM 'voyage-4'
    );

CREATE INDEX IF NOT EXISTS idx_issues_embedding_repair_voyage4
  ON issues (id)
  WHERE embedding IS NULL
     OR embedding_model IS DISTINCT FROM 'voyage-4';

CREATE INDEX IF NOT EXISTS idx_issue_comments_embedding_repair_voyage4
  ON issue_comments (id)
  WHERE embedding IS NULL
     OR embedding_model IS DISTINCT FROM 'voyage-4';

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_created_at
  ON rate_limit_events (created_at);

CREATE INDEX IF NOT EXISTS idx_resilience_events_created_at
  ON resilience_events (created_at);

CREATE INDEX IF NOT EXISTS idx_prompt_section_events_created_at
  ON prompt_section_events (created_at);
