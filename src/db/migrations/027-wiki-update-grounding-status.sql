-- Allow partially-grounded wiki suggestions.
-- Code already emits this status when post-generation grounding strips/rewrites part
-- of a suggestion but enough grounded content remains to keep it.

ALTER TABLE wiki_update_suggestions
  DROP CONSTRAINT IF EXISTS wiki_update_suggestions_grounding_status_check;

ALTER TABLE wiki_update_suggestions
  ADD CONSTRAINT wiki_update_suggestions_grounding_status_check
  CHECK (grounding_status IN ('grounded', 'partially-grounded', 'ungrounded', 'no_update'));
