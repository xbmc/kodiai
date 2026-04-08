-- 035-generated-rules.sql
-- Durable generated-rule persistence for pending/active/retired lifecycle management.

CREATE TABLE IF NOT EXISTS generated_rules (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,
  title TEXT NOT NULL,
  rule_text TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending',
  origin TEXT NOT NULL DEFAULT 'generated',

  signal_score REAL NOT NULL DEFAULT 0,
  member_count INTEGER NOT NULL DEFAULT 0,
  cluster_centroid vector(1024),

  activated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,

  CONSTRAINT generated_rules_status_check
    CHECK (status IN ('pending', 'active', 'retired')),
  CONSTRAINT generated_rules_origin_check
    CHECK (origin = 'generated'),
  CONSTRAINT generated_rules_signal_score_check
    CHECK (signal_score >= 0 AND signal_score <= 1),
  CONSTRAINT generated_rules_member_count_check
    CHECK (member_count >= 0),

  UNIQUE (repo, title)
);

CREATE INDEX IF NOT EXISTS idx_generated_rules_repo
  ON generated_rules (repo);

CREATE INDEX IF NOT EXISTS idx_generated_rules_status
  ON generated_rules (status);

CREATE INDEX IF NOT EXISTS idx_generated_rules_pending
  ON generated_rules (repo, signal_score DESC, member_count DESC, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_generated_rules_active
  ON generated_rules (repo, signal_score DESC, member_count DESC, activated_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_generated_rules_retired
  ON generated_rules (repo, retired_at DESC, updated_at DESC)
  WHERE status = 'retired';
