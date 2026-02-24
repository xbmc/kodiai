-- 004-webhook-queue.sql
-- Durable webhook queue for graceful shutdown drain.
-- New webhooks arriving during SIGTERM drain are queued here for replay after restart.

CREATE TABLE IF NOT EXISTS webhook_queue (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  delivery_id TEXT,
  event_name TEXT,
  headers JSONB NOT NULL,
  body TEXT NOT NULL,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX idx_webhook_queue_pending
  ON webhook_queue (status, queued_at)
  WHERE status = 'pending';
