-- 002-pgvector-indexes.sql
-- Create HNSW index on learning_memories embedding column for fast cosine similarity search.

CREATE INDEX IF NOT EXISTS idx_learning_memories_embedding_hnsw
  ON learning_memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
