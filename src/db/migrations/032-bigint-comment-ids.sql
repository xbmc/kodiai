-- Migration 032: Widen comment ID columns from INTEGER to BIGINT
--
-- GitHub comment IDs are 64-bit integers. As of March 2026 they exceed
-- 2^31-1 (e.g. 4153840487), causing "out of range for type integer" errors
-- when inserting partial review comment IDs into these columns.
--
-- All four affected columns are widened to BIGINT.

ALTER TABLE findings
  ALTER COLUMN comment_id TYPE BIGINT;

ALTER TABLE feedback_reactions
  ALTER COLUMN comment_id TYPE BIGINT;

ALTER TABLE review_checkpoints
  ALTER COLUMN partial_comment_id TYPE BIGINT;

ALTER TABLE resilience_events
  ALTER COLUMN partial_comment_id TYPE BIGINT;
