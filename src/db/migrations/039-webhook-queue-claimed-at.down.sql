-- 039-webhook-queue-claimed-at.down.sql

DROP INDEX IF EXISTS idx_webhook_queue_processing_claimed;

ALTER TABLE webhook_queue
  DROP COLUMN IF EXISTS claimed_at;
