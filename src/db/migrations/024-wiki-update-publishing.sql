-- Add publishing tracking columns to wiki_update_suggestions.
-- Phase 124: enables idempotent publishing — re-runs skip already-published rows.

ALTER TABLE wiki_update_suggestions
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN published_issue_number INTEGER;

-- Partial index for efficient "unpublished" queries
CREATE INDEX idx_wiki_update_suggestions_unpublished
  ON wiki_update_suggestions (page_id)
  WHERE published_at IS NULL;
