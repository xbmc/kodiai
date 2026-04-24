CREATE TABLE continuation_family_state (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  family_key TEXT NOT NULL,
  base_review_output_key TEXT NOT NULL,
  authoritative_attempt_id TEXT NOT NULL,
  authoritative_attempt_ordinal INTEGER NOT NULL,
  authoritative_outcome TEXT NOT NULL,
  final_stop_reason TEXT NOT NULL,
  projection_status TEXT NOT NULL,
  superseded_by_attempt_id TEXT,
  UNIQUE (family_key, base_review_output_key),
  CONSTRAINT continuation_family_authoritative_outcome_check CHECK (
    authoritative_outcome IN ('blocked', 'merged', 'quiet-settled', 'superseded')
  ),
  CONSTRAINT continuation_family_final_stop_reason_check CHECK (
    final_stop_reason IN (
      'merged-continuation-results',
      'no-follow-up',
      'settled-without-update',
      'superseded-by-newer-attempt'
    )
  ),
  CONSTRAINT continuation_family_projection_status_check CHECK (
    projection_status IN ('canonical', 'degraded', 'pending')
  ),
  CONSTRAINT continuation_family_attempt_ordinal_check CHECK (authoritative_attempt_ordinal >= 1)
);

CREATE INDEX idx_continuation_family_state_family_key
  ON continuation_family_state (family_key);

CREATE INDEX idx_continuation_family_state_base_review_output_key
  ON continuation_family_state (base_review_output_key);

CREATE INDEX idx_continuation_family_state_authoritative_attempt
  ON continuation_family_state (authoritative_attempt_id);
