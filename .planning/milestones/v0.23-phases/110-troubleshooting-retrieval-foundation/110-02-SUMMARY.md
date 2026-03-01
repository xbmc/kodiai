---
phase: 110-troubleshooting-retrieval-foundation
plan: 02
status: complete
---

## What was done

Comprehensive test coverage for the thread assembler and troubleshooting retrieval pipeline.

### Changes

1. **`src/knowledge/thread-assembler.test.ts`** (new) — 19 test cases:
   - `truncateIssueBody` (5 cases): short body, multi-paragraph, hard truncate, empty, custom maxChars
   - `selectTailComments` (6 cases): within budget, all fit, zero budget, empty array, chronological order, remaining excludes selected
   - `computeBudgetDistribution` (4 cases): empty, single, proportional, equal distances
   - `assembleIssueThread` (4 cases): tail+semantic, no comments, long body, budget respect

2. **`src/knowledge/troubleshooting-retrieval.test.ts`** (new) — 15 test cases:
   - `extractKeywords` (4 cases): quoted errors, component names, null body, empty strings
   - `retrieveTroubleshootingContext` (11 cases): resolved matches, state filter passthrough, similarity floor, PR exclusion, maxResults, wiki fallback, empty results null, embedding failure null, budget weighting, dual wiki query, no wiki store null

### Verification

- All 34 new tests pass
- All 456 knowledge tests pass (no regressions)
- All tests use mock stores — no database dependency
