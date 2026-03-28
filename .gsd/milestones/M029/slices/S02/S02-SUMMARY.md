---
id: S02
parent: M029
milestone: M029
provides:
  - MIN_HEURISTIC_SCORE = 3 exported constant in wiki-update-generator.ts
  - heuristic_score >= 3 WHERE clause in the page-selection SQL query (else-branch only)
  - Two new deterministic tests: constant-value assertion + SQL-capture assertion
requires:
  - slice: S01
    provides: isReasoningProse filter, Output Contract prompt section (established before S02 ran)
affects:
  - S03 (cleanup script runs after page selection is corrected)
  - S04 (proof harness includes DB-level check that uses the corrected query)
key_files:
  - src/knowledge/wiki-update-generator.ts
  - src/knowledge/wiki-update-generator.test.ts
key_decisions:
  - Threshold value 3 matches the "High" relevance band in the staleness detector taxonomy — not a magic number
  - Only the else-branch page-selection query receives the filter; the pageIds branch and evidence-fetch query in processPage are intentionally left untouched
  - SQL-capture mock pattern (tagged-template stub recording strings.join + values) chosen over a full DB integration test
patterns_established:
  - SQL-capture mock: pass a tagged-template mock function that records (strings.join("?"), values); assert both query shape and interpolated parameter value without a real DB
observability_surfaces:
  - none (constant is compile-time; SQL clause is observable via the SQL-capture test and in DB query logs at runtime)
drill_down_paths:
  - .gsd/milestones/M029/slices/S02/tasks/T01-SUMMARY.md
duration: 5m
verification_result: passed
completed_at: 2026-03-21
---

# S02: Heuristic Score Threshold in Page Selection

**Exported `MIN_HEURISTIC_SCORE = 3` and wired `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` into the page-selection query, with two new tests that prove the constant value and its presence in the SQL.**

## What Happened

T01 made two surgical additions to `wiki-update-generator.ts`:

1. **Constant:** `export const MIN_HEURISTIC_SCORE = 3;` added immediately after `MIN_OVERLAP_SCORE` (line 41). The value 3 corresponds to the "High" relevance band in the staleness detector taxonomy — the same classification already used elsewhere in the pipeline.

2. **SQL clause:** `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` inserted before `ORDER BY` in the `else`-branch page-selection query (~line 387). The `pageIds` branch (used when caller supplies explicit page IDs) and the evidence-fetch query in `processPage` were intentionally left untouched — only the automatic page-selection path needed the filter.

Two new test blocks were added to `wiki-update-generator.test.ts`:

- `MIN_HEURISTIC_SCORE > is set to 3` — direct constant-value assertion (`toBe(3)`), catching any accidental regression to the numeric value.
- `createUpdateGenerator page selection > includes heuristic_score >= MIN_HEURISTIC_SCORE` — SQL-capture test: mocks the `sql` tagged-template function, calls `generator.run({ topN: 5 })`, and asserts the captured query string contains `"heuristic_score >="` with the parameter value `3`. This pattern verifies both the query shape and the interpolated value without a real DB.

Import paths in the original plan were slightly wrong; the executor corrected them to match the actual codebase (`../llm/task-router.ts`, `pino` instead of plan's suggestions).

## Verification

`bun test src/knowledge/wiki-update-generator.test.ts` — 26 pass, 0 fail (24 pre-existing + 2 new). Runtime: 137ms.

## New Requirements Surfaced

- none (R034 was pre-declared in the milestone plan)

## Deviations

Import paths in the slice plan were slightly off (`"../tasks/task-router.ts"` → `"../llm/task-router.ts"`, `"../logger.ts"` → `"pino"`). Corrected to match actual codebase usage. No behavioral deviation.

## Known Limitations

- The `pageIds` branch of `createUpdateGenerator` bypasses the heuristic threshold entirely — callers that supply explicit page IDs receive no quality gate. This is intentional: the `pageIds` path is used for re-runs against known pages, where the caller is responsible for page selection.
- The threshold value (3) is only verified to exist in the SQL via the mock-capture test. Runtime behavior can be confirmed by querying `wiki_pr_evidence WHERE heuristic_score < 3` and observing those rows are absent from generation inputs.

## Follow-ups

- none discovered during execution

## Files Created/Modified

- `src/knowledge/wiki-update-generator.ts` — added `export const MIN_HEURISTIC_SCORE = 3` after `MIN_OVERLAP_SCORE`; added `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` in the else-branch page-selection query
- `src/knowledge/wiki-update-generator.test.ts` — added `mock`, `createUpdateGenerator`, `MIN_HEURISTIC_SCORE` to imports; added two new describe blocks at end of file

## Forward Intelligence

### What the next slice should know
- S02 only filters at page-selection time. Evidence rows with `heuristic_score < 3` that were already in `wiki_update_suggestions` prior to this slice are not retroactively removed — S04's DB cleanup step handles that separately.
- The SQL-capture mock pattern (tagged-template stub) is now the established pattern for testing SQL queries in this codebase without a real DB. S04's proof harness can reference `createUpdateGenerator page selection` as a template.
- `MIN_HEURISTIC_SCORE` is exported — S04's proof harness can import and assert on it directly.

### What's fragile
- The SQL-capture test works by calling `generator.run({ topN: 5 })` and checking if the captured SQL strings contain the expected clause. If the page-selection query is significantly restructured, the string-match assertion may need updating. It will fail loudly rather than silently.
- The mock intercepts the first SQL call; if query ordering changes and the page-selection call is no longer first, the captured call index may shift.

### Authoritative diagnostics
- `bun test src/knowledge/wiki-update-generator.test.ts` — the SQL-capture test is the authoritative check that the constant is wired into the query and not just defined.
- At runtime: `SELECT COUNT(*) FROM wiki_pr_evidence WHERE heuristic_score < 3` shows how many rows are now excluded by the threshold.

### What assumptions changed
- Plan assumed 31 existing tests; actual count was 24 pre-existing (not 31). The final count of 26 (24 + 2 new) is correct.
