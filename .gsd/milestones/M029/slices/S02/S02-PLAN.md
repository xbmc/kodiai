# S02: Heuristic Score Threshold in Page Selection

**Goal:** The page-selection query in `createUpdateGenerator` filters out PR evidence with `heuristic_score < 3`, preventing low-relevance matches from triggering wiki generation. A named constant `MIN_HEURISTIC_SCORE = 3` is exported and directly verified in tests.

**Demo:** `bun test src/knowledge/wiki-update-generator.test.ts` passes with all existing tests green plus two new tests: one asserting the constant value equals 3, one asserting the page-selection SQL query contains the `heuristic_score >=` clause with value `3`.

## Must-Haves

- `MIN_HEURISTIC_SCORE = 3` exported constant added to `wiki-update-generator.ts` alongside `MIN_OVERLAP_SCORE`
- `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` clause added to the page-selection query (the `else` branch in `createUpdateGenerator`, not the `pageIds` branch and not the evidence-fetch query)
- Two new passing tests in `wiki-update-generator.test.ts`: constant-value assertion + SQL-capture assertion
- All 31 existing tests remain green

## Verification

- `bun test src/knowledge/wiki-update-generator.test.ts` — exits 0, all tests pass including 2 new tests

## Tasks

- [x] **T01: Add heuristic score threshold constant, SQL clause, and tests** `est:45m`
  - Why: Closes R034 — page selection must enforce minimum evidence quality threshold to prevent low-relevance PR evidence from driving wiki generation
  - Files: `src/knowledge/wiki-update-generator.ts`, `src/knowledge/wiki-update-generator.test.ts`
  - Do: (1) Add `export const MIN_HEURISTIC_SCORE = 3;` after line 38 (`MIN_OVERLAP_SCORE`). (2) Add `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` before `ORDER BY` in the page-selection query (the `else` branch around line 381). (3) Add two new tests — see task plan for exact code.
  - Verify: `bun test src/knowledge/wiki-update-generator.test.ts`
  - Done when: command exits 0 with 2 new tests passing and all prior tests still green

## Files Likely Touched

- `src/knowledge/wiki-update-generator.ts`
- `src/knowledge/wiki-update-generator.test.ts`
