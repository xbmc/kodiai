-- 003-tsvector-columns.down.sql
-- Rollback: drop tsvector triggers, functions, indexes, and columns.

-- learning_memories
DROP TRIGGER IF EXISTS trg_learning_memories_search_tsv ON learning_memories;
DROP FUNCTION IF EXISTS learning_memories_search_tsv_update();
DROP INDEX IF EXISTS idx_learning_memories_search_tsv;
ALTER TABLE learning_memories DROP COLUMN IF EXISTS search_tsv;

-- findings
DROP TRIGGER IF EXISTS trg_findings_search_tsv ON findings;
DROP FUNCTION IF EXISTS findings_search_tsv_update();
DROP INDEX IF EXISTS idx_findings_search_tsv;
ALTER TABLE findings DROP COLUMN IF EXISTS search_tsv;
