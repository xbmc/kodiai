-- 014-issues.down.sql
-- Rollback: drop issue corpus tables, triggers, and functions.

DROP TRIGGER IF EXISTS trg_issue_comments_search_tsv ON issue_comments;
DROP FUNCTION IF EXISTS issue_comments_search_tsv_update();
DROP TABLE IF EXISTS issue_comments;

DROP TRIGGER IF EXISTS trg_issues_search_tsv ON issues;
DROP FUNCTION IF EXISTS issues_search_tsv_update();
DROP TABLE IF EXISTS issues;
