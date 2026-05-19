ALTER TABLE prompt_section_events
  DROP COLUMN IF EXISTS budget_chars,
  DROP COLUMN IF EXISTS budget_tokens,
  DROP COLUMN IF EXISTS included_chars,
  DROP COLUMN IF EXISTS included_tokens,
  DROP COLUMN IF EXISTS trimmed_chars,
  DROP COLUMN IF EXISTS trimmed_tokens,
  DROP COLUMN IF EXISTS budget_status,
  DROP COLUMN IF EXISTS budget_reason;
