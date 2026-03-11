# T03: 93-language-aware-retrieval-boosting 03

**Slice:** S01 — **Milestone:** M019

## Description

Consolidate language boosting into the unified cross-corpus pipeline, remove legacy double-boost, and implement proportional multi-language boosting with related-language affinity.

Purpose: All three corpora get language-aware ranking in exactly one location (LANG-03, LANG-04). No penalty for non-matching — boost only.
Output: Unified pipeline language boost, refactored reranker, updated cross-corpus types.

## Must-Haves

- [ ] "Retrieval results for a C++ PR rank C++ memories and C++-tagged wiki pages higher than Python ones"
- [ ] "Language weighting is applied in exactly one location — the unified pipeline step 6e"
- [ ] "Non-matching results keep their original score, never penalized"
- [ ] "Multi-language PRs apply proportional boost by change volume"
- [ ] "Related languages (C/C++) get a fraction of exact-match boost"

## Files

- `src/knowledge/retrieval-rerank.ts`
- `src/knowledge/retrieval-rerank.test.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/retrieval.test.ts`
- `src/knowledge/cross-corpus-rrf.ts`
- `src/knowledge/cross-corpus-rrf.test.ts`
- `src/knowledge/wiki-retrieval.ts`
