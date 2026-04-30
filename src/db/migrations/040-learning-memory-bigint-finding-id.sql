-- Promote learning memory finding IDs to BIGINT so GitHub review comment IDs
-- larger than 32-bit signed integer range can be stored as finding references.
-- GitHub IDs commonly exceed 2,147,483,647.

ALTER TABLE learning_memories
  ALTER COLUMN finding_id TYPE BIGINT;
