# T01: 120-embedding-migration 01

**Slice:** S01 — **Milestone:** M025

## Description

Create the contextualized embedding provider, parameterize wiki-store to accept embedding model name, and wire per-corpus model routing through the retrieval pipeline.

Purpose: Enable wiki corpus to use voyage-context-3 while all other corpora (code, reviews, issues, snippets) continue using voyage-code-3. This is the foundation for the backfill migration in plan 120-02.

Output: Production code changes that create two embedding providers and route them correctly through all wiki-touching code paths.

## Must-Haves

- [ ] "Wiki store writes chunks with embedding model name from provider, not hardcoded voyage-code-3"
- [ ] "Retrieval pipeline uses wiki-specific embedding provider for wiki vector searches while other corpora use the shared voyage-code-3 provider"
- [ ] "A contextualized embedding provider exists that calls client.contextualizedEmbed() instead of client.embed()"
- [ ] "Troubleshooting retrieval passes wiki-specific provider to searchWikiPages calls"

## Files

- `src/knowledge/embeddings.ts`
- `src/knowledge/wiki-store.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/troubleshooting-retrieval.ts`
- `src/index.ts`
