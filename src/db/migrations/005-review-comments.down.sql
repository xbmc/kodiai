-- 005-review-comments.down.sql
-- Rollback: drop review comment tables and related objects.

DROP TRIGGER IF EXISTS trg_review_comments_search_tsv ON review_comments;
DROP FUNCTION IF EXISTS review_comments_search_tsv_update();

DROP INDEX IF EXISTS idx_review_comments_search_tsv;
DROP INDEX IF EXISTS idx_review_comments_stale;
DROP INDEX IF EXISTS idx_review_comments_embedding_hnsw;
DROP INDEX IF EXISTS idx_review_comments_github_id;
DROP INDEX IF EXISTS idx_review_comments_author;
DROP INDEX IF EXISTS idx_review_comments_pr;
DROP INDEX IF EXISTS idx_review_comments_thread;
DROP INDEX IF EXISTS idx_review_comments_repo;

DROP TABLE IF EXISTS review_comment_sync_state;
DROP TABLE IF EXISTS review_comments;
