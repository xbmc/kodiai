-- 003-tsvector-columns.sql
-- Add tsvector columns and GIN indexes for full-text search.

-- learning_memories: full-text search on finding_text
ALTER TABLE learning_memories ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE INDEX IF NOT EXISTS idx_learning_memories_search_tsv
  ON learning_memories USING gin (search_tsv);

CREATE OR REPLACE FUNCTION learning_memories_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', COALESCE(NEW.finding_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_learning_memories_search_tsv ON learning_memories;
CREATE TRIGGER trg_learning_memories_search_tsv
  BEFORE INSERT OR UPDATE OF finding_text ON learning_memories
  FOR EACH ROW
  EXECUTE FUNCTION learning_memories_search_tsv_update();

-- Backfill existing rows (no-op on fresh DB)
UPDATE learning_memories SET search_tsv = to_tsvector('english', COALESCE(finding_text, ''))
  WHERE search_tsv IS NULL;

-- findings: full-text search on title
ALTER TABLE findings ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE INDEX IF NOT EXISTS idx_findings_search_tsv
  ON findings USING gin (search_tsv);

CREATE OR REPLACE FUNCTION findings_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', COALESCE(NEW.title, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_findings_search_tsv ON findings;
CREATE TRIGGER trg_findings_search_tsv
  BEFORE INSERT OR UPDATE OF title ON findings
  FOR EACH ROW
  EXECUTE FUNCTION findings_search_tsv_update();

-- Backfill existing rows (no-op on fresh DB)
UPDATE findings SET search_tsv = to_tsvector('english', COALESCE(title, ''))
  WHERE search_tsv IS NULL;
