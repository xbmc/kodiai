DROP INDEX IF EXISTS idx_wiki_update_suggestions_unpublished;
ALTER TABLE wiki_update_suggestions
  DROP COLUMN IF EXISTS published_at,
  DROP COLUMN IF EXISTS published_issue_number;
