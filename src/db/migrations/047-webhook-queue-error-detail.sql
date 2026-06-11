-- 047-webhook-queue-error-detail.sql
-- Persist why a queued webhook replay failed. markFailed previously discarded
-- the error, leaving failed rows with no diagnostic.

ALTER TABLE webhook_queue
  ADD COLUMN IF NOT EXISTS error_message TEXT;
