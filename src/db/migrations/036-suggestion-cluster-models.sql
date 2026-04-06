-- 036-suggestion-cluster-models.sql
-- Per-repo positive/negative cluster model cache for embedding-based
-- suggestion filtering and confidence adjustment (M037).
--
-- Each row holds the pre-built centroid arrays for a single repo's
-- positive (accepted/thumbs-up) and negative (thumbs-down/suppressed)
-- outcome clusters. Models are refreshed in a background job with a
-- 24-hour TTL; the live review path reads from this cache.

CREATE TABLE IF NOT EXISTS suggestion_cluster_models (
  id            BIGSERIAL    PRIMARY KEY,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  repo          TEXT         NOT NULL,

  -- JSONB arrays of centroid vectors (each centroid is a JSONB number[]).
  -- Shape: [[f32, f32, ...], [f32, f32, ...], ...]
  positive_centroids JSONB   NOT NULL DEFAULT '[]',
  negative_centroids JSONB   NOT NULL DEFAULT '[]',

  -- Total learning-memory rows that contributed to this model build.
  member_count  INTEGER      NOT NULL DEFAULT 0,

  -- Positive and negative split counts (informational, used for diagnostics).
  positive_member_count INTEGER NOT NULL DEFAULT 0,
  negative_member_count INTEGER NOT NULL DEFAULT 0,

  -- Timestamp the model was computed (same as updated_at, kept separate
  -- so callers can compare built_at against a fixed TTL without risking
  -- confusion with the row's updated_at bookkeeping column).
  built_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- TTL: after this timestamp the model should be considered stale and
  -- rebuilt on the next refresh cycle.
  expires_at    TIMESTAMPTZ  NOT NULL,

  CONSTRAINT suggestion_cluster_models_member_count_check
    CHECK (member_count >= 0),
  CONSTRAINT suggestion_cluster_models_positive_member_count_check
    CHECK (positive_member_count >= 0),
  CONSTRAINT suggestion_cluster_models_negative_member_count_check
    CHECK (negative_member_count >= 0),

  -- One model per repo (upserted on refresh).
  UNIQUE (repo)
);

-- Fast single-repo lookup (primary access pattern).
CREATE INDEX IF NOT EXISTS idx_suggestion_cluster_models_repo
  ON suggestion_cluster_models (repo);

-- TTL sweep: find expired models for background refresh.
CREATE INDEX IF NOT EXISTS idx_suggestion_cluster_models_expires
  ON suggestion_cluster_models (expires_at ASC);
