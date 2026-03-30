-- Rollback migration 032: revert comment ID columns back to INTEGER
-- WARNING: data loss if any stored values exceed 2^31-1.

ALTER TABLE findings
  ALTER COLUMN comment_id TYPE INTEGER;

ALTER TABLE feedback_reactions
  ALTER COLUMN comment_id TYPE INTEGER;

ALTER TABLE review_checkpoints
  ALTER COLUMN partial_comment_id TYPE INTEGER;

ALTER TABLE resilience_events
  ALTER COLUMN partial_comment_id TYPE INTEGER;
