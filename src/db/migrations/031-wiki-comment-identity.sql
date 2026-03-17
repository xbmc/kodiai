-- Add published_comment_id for durable wiki comment identity (S02).
-- BIGINT required — GitHub comment IDs exceed 32-bit int range.
ALTER TABLE wiki_update_suggestions
  ADD COLUMN IF NOT EXISTS published_comment_id BIGINT;
