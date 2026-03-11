# S01: Language Aware Retrieval Boosting

**Goal:** Add language column to learning_memories, expand the language classification taxonomy to 30+ languages, add context-aware classification for ambiguous extensions, and populate the language column on new memory writes.
**Demo:** Add language column to learning_memories, expand the language classification taxonomy to 30+ languages, add context-aware classification for ambiguous extensions, and populate the language column on new memory writes.

## Must-Haves


## Tasks

- [x] **T01: 93-language-aware-retrieval-boosting 01** `est:5min`
  - Add language column to learning_memories, expand the language classification taxonomy to 30+ languages, add context-aware classification for ambiguous extensions, and populate the language column on new memory writes.

Purpose: Store programming language metadata at write time so retrieval can use it without runtime re-classification (LANG-01). Sets up schema for backfill (LANG-02).
Output: Migration 007, expanded classifyFileLanguage, updated writeMemory with language population.
- [x] **T02: 93-language-aware-retrieval-boosting 02**
  - Add language affinity tag detection to wiki page chunking and wire it through the wiki store for persistence.

Purpose: Wiki pages carry language metadata so language-filtered retrieval spans all three corpora (LANG-05).
Output: detectLanguageTags function, updated WikiPageChunk/WikiPageRecord types, wiki-store writes language_tags.
- [x] **T03: 93-language-aware-retrieval-boosting 03** `est:6min`
  - Consolidate language boosting into the unified cross-corpus pipeline, remove legacy double-boost, and implement proportional multi-language boosting with related-language affinity.

Purpose: All three corpora get language-aware ranking in exactly one location (LANG-03, LANG-04). No penalty for non-matching — boost only.
Output: Unified pipeline language boost, refactored reranker, updated cross-corpus types.
- [x] **T04: 93-language-aware-retrieval-boosting 04** `est:6min`
  - Wire language metadata through all consumer paths: review handler pre-classifies languages for memory writes, wiki retrieval exposes language tags, and e2e tests validate end-to-end language-aware ranking.

Purpose: Complete the integration — all write paths store language, all read paths use it, and tests prove it works end-to-end.
Output: Updated handlers, wiki retrieval types, comprehensive e2e test.

## Files Likely Touched

- `src/db/migrations/007-language-column.sql`
- `src/db/migrations/007-language-column.down.sql`
- `src/execution/diff-analysis.ts`
- `src/execution/diff-analysis.test.ts`
- `src/knowledge/types.ts`
- `src/knowledge/memory-store.ts`
- `src/knowledge/memory-store.test.ts`
- `src/scripts/backfill-language.ts`
- `src/knowledge/wiki-chunker.ts`
- `src/knowledge/wiki-chunker.test.ts`
- `src/knowledge/wiki-types.ts`
- `src/knowledge/wiki-store.ts`
- `src/knowledge/wiki-store.test.ts`
- `src/knowledge/retrieval-rerank.ts`
- `src/knowledge/retrieval-rerank.test.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/retrieval.test.ts`
- `src/knowledge/cross-corpus-rrf.ts`
- `src/knowledge/cross-corpus-rrf.test.ts`
- `src/knowledge/wiki-retrieval.ts`
- `src/knowledge/wiki-retrieval.test.ts`
- `src/knowledge/retrieval.e2e.test.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
