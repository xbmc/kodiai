-- 004-webhook-queue.down.sql
-- Rollback: drop webhook_queue table and its index.

DROP INDEX IF EXISTS idx_webhook_queue_pending;
DROP TABLE IF EXISTS webhook_queue;
