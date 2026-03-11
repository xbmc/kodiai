# T03: 96-code-snippet-embedding 03

**Slice:** S04 — **Milestone:** M019

## Description

Implement the code snippet store (PostgreSQL + pgvector) and retrieval search module.

Purpose: Provide persistent storage with content-hash deduplication and vector similarity search for hunk embeddings.
Output: Store module with UPSERT dedup logic, retrieval module with fail-open search.

## Must-Haves

- [ ] writeSnippet uses UPSERT on content_hash — identical content is not re-embedded
- [ ] writeOccurrence creates junction table entries linking content_hash to PR/file/line metadata
- [ ] searchByEmbedding returns CodeSnippetSearchResult with best occurrence metadata joined
- [ ] Embedding provider failure returns empty results (fail-open)
- [ ] searchByFullText uses tsvector index for BM25 ranking

## Files

- `src/knowledge/code-snippet-store.ts`
- `src/knowledge/code-snippet-store.test.ts`
- `src/knowledge/code-snippet-retrieval.ts`
- `src/knowledge/code-snippet-retrieval.test.ts`
