ALTER TABLE wiki_update_suggestions
  DROP CONSTRAINT IF EXISTS wiki_update_suggestions_grounding_status_check;

ALTER TABLE wiki_update_suggestions
  ADD CONSTRAINT wiki_update_suggestions_grounding_status_check
  CHECK (grounding_status IN ('grounded', 'ungrounded', 'no_update'));
