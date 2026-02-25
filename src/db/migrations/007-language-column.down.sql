-- 007-language-column.down.sql
-- Rollback: remove language columns from learning_memories and wiki_pages.

DROP INDEX IF EXISTS idx_memories_language;
DROP INDEX IF EXISTS idx_wiki_pages_language_tags;
ALTER TABLE learning_memories DROP COLUMN IF EXISTS language;
ALTER TABLE wiki_pages DROP COLUMN IF EXISTS language_tags;
