-- 001-initial-schema.down.sql
-- Rollback: drop all tables in reverse dependency order, then pgvector extension.

DROP TABLE IF EXISTS learning_memories;
DROP TABLE IF EXISTS resilience_events;
DROP TABLE IF EXISTS retrieval_quality_events;
DROP TABLE IF EXISTS rate_limit_events;
DROP TABLE IF EXISTS telemetry_events;
DROP TABLE IF EXISTS review_checkpoints;
DROP TABLE IF EXISTS dep_bump_merge_history;
DROP TABLE IF EXISTS author_cache;
DROP TABLE IF EXISTS run_state;
DROP TABLE IF EXISTS feedback_reactions;
DROP TABLE IF EXISTS global_patterns;
DROP TABLE IF EXISTS suppression_log;
DROP TABLE IF EXISTS findings;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS _migrations;

DROP EXTENSION IF EXISTS vector;
