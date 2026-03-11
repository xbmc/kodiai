# T02: 93-language-aware-retrieval-boosting 02

**Slice:** S01 — **Milestone:** M019

## Description

Add language affinity tag detection to wiki page chunking and wire it through the wiki store for persistence.

Purpose: Wiki pages carry language metadata so language-filtered retrieval spans all three corpora (LANG-05).
Output: detectLanguageTags function, updated WikiPageChunk/WikiPageRecord types, wiki-store writes language_tags.

## Must-Haves

- [ ] "Wiki page chunks carry language affinity tags determined by content analysis"
- [ ] "Non-code wiki pages are tagged as 'general'"
- [ ] "Pages with multiple code languages get multiple tags"
- [ ] "Language tags are re-analyzed on every re-ingest via replacePageChunks"

## Files

- `src/knowledge/wiki-chunker.ts`
- `src/knowledge/wiki-chunker.test.ts`
- `src/knowledge/wiki-types.ts`
- `src/knowledge/wiki-store.ts`
- `src/knowledge/wiki-store.test.ts`
