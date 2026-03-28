---
id: T01
parent: S02
milestone: M029
provides:
  - MIN_HEURISTIC_SCORE constant (value 3) exported from wiki-update-generator.ts
  - heuristic_score >= 3 WHERE clause in the page-selection SQL query
  - Two new tests: constant-value assertion + SQL-capture assertion
key_files:
  - src/knowledge/wiki-update-generator.ts
  - src/knowledge/wiki-update-generator.test.ts
key_decisions:
  - Threshold set to 3 ("High" relevance in staleness detector taxonomy), matching the existing score-band definition
patterns_established:
  - SQL-capture mock pattern: pass a tagged-template mock that records (strings.join("?"), values) to assert both the query shape and the interpolated parameter value without a real DB
observability_surfaces:
  - none (constant is compile-time; SQL clause is observable via the captured-calls test and in DB query logs at runtime)
duration: 5m
verification_result: passed
completed_at: 2026-03-21
blocker_discovered: false
---

# T01: Add heuristic score threshold constant, SQL clause, and tests

**Exported `MIN_HEURISTIC_SCORE = 3` and added `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` to the page-selection query, with two new tests proving the constant value and its wiring into SQL.**

## What Happened

- Added `export const MIN_HEURISTIC_SCORE = 3;` immediately after `MIN_OVERLAP_SCORE` on line 41 of `wiki-update-generator.ts`.
- Added `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` before `ORDER BY` in the `else`-branch page-selection query (~line 387). The `pageIds` branch and the evidence-fetch query in `processPage` were intentionally left untouched.
- Updated the test-file import to include `mock` from `bun:test` and `createUpdateGenerator`, `MIN_HEURISTIC_SCORE` from the source module.
- Added two `describe` blocks at the end of the test file:
  - `MIN_HEURISTIC_SCORE` — constant-value assertion (`toBe(3)`).
  - `createUpdateGenerator page selection` — SQL-capture test: mocks the `sql` tagged-template function, calls `generator.run({ topN: 5 })`, and asserts the captured query string contains `"heuristic_score >="` with parameter value `3`.
- Import paths adjusted from the plan's suggestions to match reality: `Sql` from `"../db/client.ts"`, `TaskRouter` from `"../llm/task-router.ts"`, `Logger` from `"pino"`.

## Verification

Ran `bun test src/knowledge/wiki-update-generator.test.ts`. All 26 tests passed (24 pre-existing + 2 new). No failures or regressions.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/knowledge/wiki-update-generator.test.ts` | 0 | ✅ pass | 129ms |

## Diagnostics

To inspect the threshold at runtime: query `wiki_pr_evidence` and filter `WHERE heuristic_score < 3` to find evidence rows that are now excluded from page selection. The SQL-capture test (`createUpdateGenerator page selection`) serves as the authoritative check that the constant is wired into the query and not just defined.

## Deviations

Import paths in the plan were slightly wrong (`"../tasks/task-router.ts"` → `"../llm/task-router.ts"`, `"../logger.ts"` → `"pino"`). Corrected to match actual imports used in the codebase.

## Known Issues

none

## Files Created/Modified

- `src/knowledge/wiki-update-generator.ts` — added `export const MIN_HEURISTIC_SCORE = 3` and `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` clause in page-selection query
- `src/knowledge/wiki-update-generator.test.ts` — added `mock`, `createUpdateGenerator`, `MIN_HEURISTIC_SCORE` to imports; added two new test blocks
