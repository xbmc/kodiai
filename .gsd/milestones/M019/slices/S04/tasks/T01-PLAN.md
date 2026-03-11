# T01: 96-code-snippet-embedding 01

**Slice:** S04 — **Milestone:** M019

## Description

Create the foundation types, database schema, and config extension for code snippet embedding.

Purpose: Establish the data layer and type contracts that all subsequent plans build on.
Output: Migration SQL, TypeScript types, extended SourceType, config schema for hunkEmbedding.

## Must-Haves

- [ ] code_snippets table exists with content_hash unique constraint, embedding vector(1024), language, and tsvector columns
- [ ] code_snippet_occurrences junction table links content_hash to repo/pr/file/line metadata
- [ ] SourceType union includes "snippet" alongside code, review_comment, wiki
- [ ] .kodiai.yml schema accepts retrieval.hunkEmbedding.enabled and retrieval.hunkEmbedding.maxHunksPerPr

## Files

- `src/knowledge/code-snippet-types.ts`
- `src/db/migrations/009-code-snippets.sql`
- `src/db/migrations/009-code-snippets.down.sql`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/knowledge/cross-corpus-rrf.ts`
