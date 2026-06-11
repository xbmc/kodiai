-- Rollback: drop the webhook replay error detail column.

ALTER TABLE webhook_queue
  DROP COLUMN IF EXISTS error_message;
