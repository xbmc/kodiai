-- Rollback risk: learning_memories.finding_id may now contain GitHub review
-- comment IDs larger than PostgreSQL INTEGER can represent. This down migration
-- intentionally fails fast with a clear error if any such rows exist so rollback
-- operators do not silently lose learning-memory references.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM learning_memories
    WHERE finding_id > 2147483647 OR finding_id < -2147483648
  ) THEN
    RAISE EXCEPTION 'Cannot downgrade learning_memories.finding_id to INTEGER: out-of-range BIGINT values exist';
  END IF;
END $$;

ALTER TABLE learning_memories
  ALTER COLUMN finding_id TYPE INTEGER;
