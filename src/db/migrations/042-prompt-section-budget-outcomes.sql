ALTER TABLE prompt_section_events
  ADD COLUMN budget_chars INTEGER,
  ADD COLUMN budget_tokens INTEGER,
  ADD COLUMN included_chars INTEGER,
  ADD COLUMN included_tokens INTEGER,
  ADD COLUMN trimmed_chars INTEGER,
  ADD COLUMN trimmed_tokens INTEGER,
  ADD COLUMN budget_status TEXT,
  ADD COLUMN budget_reason TEXT;
