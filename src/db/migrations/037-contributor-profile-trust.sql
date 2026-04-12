-- 037-contributor-profile-trust.sql
-- Persist a versioned trust marker so runtime code can distinguish
-- linked-unscored, legacy, stale, malformed, and calibrated contributor rows
-- without inferring trust from raw overall_tier alone.

ALTER TABLE contributor_profiles
  ADD COLUMN IF NOT EXISTS trust_marker TEXT;

CREATE INDEX IF NOT EXISTS idx_contributor_profiles_trust_marker
  ON contributor_profiles (trust_marker)
  WHERE trust_marker IS NOT NULL;
