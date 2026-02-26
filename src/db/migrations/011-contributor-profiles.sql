-- Migration 011: Contributor profiles and expertise tracking
-- Supports identity linking (GitHub <-> Slack), expertise scoring, and privacy opt-out.

CREATE TABLE contributor_profiles (
  id              BIGSERIAL PRIMARY KEY,
  github_username TEXT NOT NULL UNIQUE,
  slack_user_id   TEXT UNIQUE,
  display_name    TEXT,
  overall_tier    TEXT NOT NULL DEFAULT 'newcomer',
  overall_score   REAL NOT NULL DEFAULT 0,
  opted_out       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scored_at  TIMESTAMPTZ
);

CREATE INDEX idx_contributor_profiles_github ON contributor_profiles (github_username);
CREATE INDEX idx_contributor_profiles_slack ON contributor_profiles (slack_user_id) WHERE slack_user_id IS NOT NULL;
CREATE INDEX idx_contributor_profiles_tier ON contributor_profiles (overall_tier);

CREATE TABLE contributor_expertise (
  id          BIGSERIAL PRIMARY KEY,
  profile_id  BIGINT NOT NULL REFERENCES contributor_profiles(id) ON DELETE CASCADE,
  dimension   TEXT NOT NULL,
  topic       TEXT NOT NULL,
  score       REAL NOT NULL DEFAULT 0,
  raw_signals INTEGER NOT NULL DEFAULT 0,
  last_active TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, dimension, topic)
);

CREATE INDEX idx_contributor_expertise_profile ON contributor_expertise (profile_id);
CREATE INDEX idx_contributor_expertise_dimension ON contributor_expertise (dimension, topic);
