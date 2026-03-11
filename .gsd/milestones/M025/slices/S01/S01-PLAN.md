# S01: Embedding Migration

**Goal:** Create the contextualized embedding provider, parameterize wiki-store to accept embedding model name, and wire per-corpus model routing through the retrieval pipeline.
**Demo:** Create the contextualized embedding provider, parameterize wiki-store to accept embedding model name, and wire per-corpus model routing through the retrieval pipeline.

## Must-Haves


## Tasks

- [x] **T01: 120-embedding-migration 01** `est:3min`
  - Create the contextualized embedding provider, parameterize wiki-store to accept embedding model name, and wire per-corpus model routing through the retrieval pipeline.

Purpose: Enable wiki corpus to use voyage-context-3 while all other corpora (code, reviews, issues, snippets) continue using voyage-code-3. This is the foundation for the backfill migration in plan 120-02.

Output: Production code changes that create two embedding providers and route them correctly through all wiki-touching code paths.
- [x] **T02: 120-embedding-migration 02** `est:2min`
  - Create the wiki embedding backfill script and the comparison benchmark script for the voyage-code-3 to voyage-context-3 migration.

Purpose: EMBED-01 requires all wiki page embeddings to be re-generated with voyage-context-3 atomically. The backfill script overwrites embeddings in place. The comparison benchmark validates retrieval quality before and after migration.

Output: Two reusable scripts in scripts/ directory.

## Files Likely Touched

- `src/knowledge/embeddings.ts`
- `src/knowledge/wiki-store.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/troubleshooting-retrieval.ts`
- `src/index.ts`
- `scripts/wiki-embedding-backfill.ts`
- `scripts/embedding-comparison.ts`
