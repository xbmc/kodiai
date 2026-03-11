# T04: 93-language-aware-retrieval-boosting 04

**Slice:** S01 — **Milestone:** M019

## Description

Wire language metadata through all consumer paths: review handler pre-classifies languages for memory writes, wiki retrieval exposes language tags, and e2e tests validate end-to-end language-aware ranking.

Purpose: Complete the integration — all write paths store language, all read paths use it, and tests prove it works end-to-end.
Output: Updated handlers, wiki retrieval types, comprehensive e2e test.

## Must-Haves

- [ ] "End-to-end retrieval test confirms language-aware ranking across all three corpora"
- [ ] "Review handler passes context-aware language classification to memory writes"
- [ ] "Wiki retrieval returns languageTags in search results for unified pipeline consumption"
- [ ] "Mention handler passes prLanguages to retrieval for language-aware boosting"

## Files

- `src/knowledge/wiki-retrieval.test.ts`
- `src/knowledge/retrieval.e2e.test.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
