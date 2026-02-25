-- 006-wiki-pages.down.sql
-- Rollback: drop wiki page tables and related objects.

DROP TRIGGER IF EXISTS trg_wiki_pages_search_tsv ON wiki_pages;
DROP FUNCTION IF EXISTS wiki_pages_search_tsv_update();

DROP INDEX IF EXISTS idx_wiki_pages_search_tsv;
DROP INDEX IF EXISTS idx_wiki_pages_stale;
DROP INDEX IF EXISTS idx_wiki_pages_embedding_hnsw;
DROP INDEX IF EXISTS idx_wiki_pages_title;
DROP INDEX IF EXISTS idx_wiki_pages_namespace;
DROP INDEX IF EXISTS idx_wiki_pages_page_id;

DROP TABLE IF EXISTS wiki_sync_state;
DROP TABLE IF EXISTS wiki_pages;
