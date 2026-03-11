# T01: 93-language-aware-retrieval-boosting 01

**Slice:** S01 — **Milestone:** M019

## Description

Add language column to learning_memories, expand the language classification taxonomy to 30+ languages, add context-aware classification for ambiguous extensions, and populate the language column on new memory writes.

Purpose: Store programming language metadata at write time so retrieval can use it without runtime re-classification (LANG-01). Sets up schema for backfill (LANG-02).
Output: Migration 007, expanded classifyFileLanguage, updated writeMemory with language population.

## Must-Haves

- [ ] "learning_memories table has a nullable language TEXT column with an index"
- [ ] "New learning memory records written via writeMemory() include the classified language"
- [ ] "EXTENSION_LANGUAGE_MAP covers 30+ languages including comprehensive C/C++ and ambiguous extension handling"
- [ ] "classifyFileLanguage resolves .h files using repository context when available"
- [ ] "Backfill script logs stats at completion: total records, records per language, records marked unknown, failures"

## Files

- `src/db/migrations/007-language-column.sql`
- `src/db/migrations/007-language-column.down.sql`
- `src/execution/diff-analysis.ts`
- `src/execution/diff-analysis.test.ts`
- `src/knowledge/types.ts`
- `src/knowledge/memory-store.ts`
- `src/knowledge/memory-store.test.ts`
- `src/scripts/backfill-language.ts`
