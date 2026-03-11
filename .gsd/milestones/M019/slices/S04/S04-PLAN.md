# S04: Code Snippet Embedding

**Goal:** Create the foundation types, database schema, and config extension for code snippet embedding.
**Demo:** Create the foundation types, database schema, and config extension for code snippet embedding.

## Must-Haves


## Tasks

- [x] **T01: 96-code-snippet-embedding 01**
  - Create the foundation types, database schema, and config extension for code snippet embedding.

Purpose: Establish the data layer and type contracts that all subsequent plans build on.
Output: Migration SQL, TypeScript types, extended SourceType, config schema for hunkEmbedding.
- [x] **T02: 96-code-snippet-embedding 02**
  - Build the diff hunk parser and embedding text assembler using TDD.

Purpose: Parse unified diff format into embeddable hunk chunks with all filtering rules applied.
Output: Thoroughly tested chunker module with parseDiffHunks, buildEmbeddingText, applyHunkCap, and isExcludedPath.
- [x] **T03: 96-code-snippet-embedding 03**
  - Implement the code snippet store (PostgreSQL + pgvector) and retrieval search module.

Purpose: Provide persistent storage with content-hash deduplication and vector similarity search for hunk embeddings.
Output: Store module with UPSERT dedup logic, retrieval module with fail-open search.
- [x] **T04: 96-code-snippet-embedding 04**
  - Wire code snippets into the cross-corpus retrieval pipeline and trigger hunk embedding from the review handler.

Purpose: Complete the end-to-end integration — hunks are embedded after review and appear in retrieval results.
Output: Fourth corpus in RRF pipeline, async embedding trigger in review handler.

## Files Likely Touched

- `src/knowledge/code-snippet-types.ts`
- `src/db/migrations/009-code-snippets.sql`
- `src/db/migrations/009-code-snippets.down.sql`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/knowledge/cross-corpus-rrf.ts`
- `src/knowledge/code-snippet-chunker.ts`
- `src/knowledge/code-snippet-chunker.test.ts`
- `src/knowledge/code-snippet-store.ts`
- `src/knowledge/code-snippet-store.test.ts`
- `src/knowledge/code-snippet-retrieval.ts`
- `src/knowledge/code-snippet-retrieval.test.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/index.ts`
- `src/handlers/review.ts`
- `src/index.ts`
- `src/knowledge/retrieval.test.ts`
