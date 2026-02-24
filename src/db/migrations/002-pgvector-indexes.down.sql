-- 002-pgvector-indexes.down.sql
-- Rollback: drop HNSW indexes on embedding columns.

DROP INDEX IF EXISTS idx_learning_memories_embedding_hnsw;
