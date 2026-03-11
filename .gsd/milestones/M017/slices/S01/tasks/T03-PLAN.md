# T03: 86-postgresql-pgvector-on-azure 03

**Slice:** S01 — **Milestone:** M017

## Description

Port the LearningMemoryStore from sqlite-vec to postgres.js + pgvector. Replace the vec0 virtual table with native pgvector vector columns and HNSW index queries. Update all retrieval pipeline modules that depend on the store.

Purpose: Eliminate the sqlite-vec dependency and use pgvector's native HNSW indexes for vector similarity search, which is the core capability enabling learning memory retrieval.

Output: Rewritten memory-store.ts using pgvector, updated retrieval pipeline modules, passing tests.

## Must-Haves

- [ ] "LearningMemoryStore uses postgres.js + pgvector for all vector operations"
- [ ] "Vector similarity queries use HNSW index with cosine distance operator"
- [ ] "No sqlite-vec or bun:sqlite imports remain in src/learning/"
- [ ] "writeMemory stores embeddings as vector(1024) column values"
- [ ] "retrieveMemories uses pgvector <=> operator for cosine distance search"
- [ ] "retrieveMemoriesForOwner queries across repo partitions using pgvector"
- [ ] "All retrieval pipeline modules updated for async postgres.js calls"

## Files

- `src/learning/memory-store.ts`
- `src/learning/memory-store.test.ts`
- `src/learning/retrieval-query.ts`
- `src/learning/retrieval-query.test.ts`
- `src/learning/retrieval-rerank.ts`
- `src/learning/retrieval-rerank.test.ts`
- `src/learning/multi-query-retrieval.ts`
- `src/learning/multi-query-retrieval.test.ts`
