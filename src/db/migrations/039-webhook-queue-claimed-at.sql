-- 039-webhook-queue-claimed-at.sql
-- Track when queued webhooks are claimed for replay so crash recovery is based
-- on replay claim age, not original enqueue age.

ALTER TABLE webhook_queue
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_webhook_queue_processing_claimed
  ON webhook_queue (status, claimed_at)
  WHERE status = 'processing';
