DROP INDEX IF EXISTS idx_contributor_profiles_trust_marker;

ALTER TABLE contributor_profiles
  DROP COLUMN IF EXISTS trust_marker;
