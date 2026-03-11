# T02: 57-analysis-layer 02

**Slice:** S02 — **Milestone:** M010

## Description

Create the retrieval recency weighting module that chains after language-aware reranking.

Purpose: Implements RET-04 -- recent learning memories score higher than stale ones, with a severity-aware decay floor that prevents CRITICAL/MAJOR findings from being forgotten. This is a pure function that takes RerankedResult[] (from rerankByLanguage) and returns RerankedResult[] with adjusted distances.

Output: New module with tests in src/learning/

## Must-Haves

- [ ] "Results from the last 30 days score higher (lower adjustedDistance) than equivalent results from 6+ months ago"
- [ ] "CRITICAL/MAJOR findings have a severity-aware decay floor of 0.3 minimum multiplier"
- [ ] "Non-critical findings have a lower floor (0.15) allowing more aggressive decay"
- [ ] "Unknown-age results (missing createdAt) are treated as recent, not penalized"
- [ ] "Output is re-sorted by adjustedDistance after weighting"

## Files

- `src/learning/retrieval-recency.ts`
- `src/learning/retrieval-recency.test.ts`
