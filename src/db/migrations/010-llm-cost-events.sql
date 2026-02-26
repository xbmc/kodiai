CREATE TABLE llm_cost_events (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_id   TEXT,
  repo          TEXT NOT NULL,
  task_type     TEXT NOT NULL,
  model         TEXT NOT NULL,
  provider      TEXT NOT NULL,
  sdk           TEXT NOT NULL,           -- 'agent' or 'ai'
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens    INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens   INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd   NUMERIC(12, 8) NOT NULL DEFAULT 0,
  duration_ms   INTEGER,
  used_fallback BOOLEAN NOT NULL DEFAULT false,
  fallback_reason TEXT,
  error         TEXT
);

-- Indexes for common query patterns
CREATE INDEX idx_llm_cost_events_repo ON llm_cost_events (repo);
CREATE INDEX idx_llm_cost_events_task_type ON llm_cost_events (task_type);
CREATE INDEX idx_llm_cost_events_model ON llm_cost_events (model);
CREATE INDEX idx_llm_cost_events_created_at ON llm_cost_events (created_at);
CREATE INDEX idx_llm_cost_events_delivery_id ON llm_cost_events (delivery_id);
