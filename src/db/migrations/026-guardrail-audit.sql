CREATE TABLE IF NOT EXISTS guardrail_audit (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  surface       TEXT NOT NULL,
  repo          TEXT NOT NULL,
  strictness    TEXT NOT NULL DEFAULT 'standard',
  claims_total  INT NOT NULL DEFAULT 0,
  claims_grounded INT NOT NULL DEFAULT 0,
  claims_removed INT NOT NULL DEFAULT 0,
  claims_ambiguous INT NOT NULL DEFAULT 0,
  llm_fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  response_suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  classifier_error BOOLEAN NOT NULL DEFAULT FALSE,
  removed_claims JSONB,
  duration_ms   INT
);
CREATE INDEX IF NOT EXISTS idx_guardrail_audit_surface ON guardrail_audit (surface);
CREATE INDEX IF NOT EXISTS idx_guardrail_audit_repo ON guardrail_audit (repo);
CREATE INDEX IF NOT EXISTS idx_guardrail_audit_created ON guardrail_audit (created_at);
