CREATE TABLE prompt_section_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_id TEXT,
  repo TEXT NOT NULL,
  task_type TEXT NOT NULL,
  prompt_kind TEXT NOT NULL,
  section_name TEXT NOT NULL,
  section_position INTEGER NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  truncated BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX idx_prompt_section_events_delivery_path_position
  ON prompt_section_events (delivery_id, task_type, prompt_kind, section_position)
  WHERE delivery_id IS NOT NULL;

CREATE INDEX idx_prompt_section_events_repo_task_created
  ON prompt_section_events (repo, task_type, created_at);

CREATE INDEX idx_prompt_section_events_section_name
  ON prompt_section_events (section_name);
