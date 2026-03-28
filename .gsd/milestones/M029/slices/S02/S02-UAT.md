# S02: Heuristic Score Threshold in Page Selection — UAT

**Milestone:** M029
**Written:** 2026-03-21

## UAT Type

- UAT mode: artifact-driven (unit tests)
- Why this mode is sufficient: S02 is a pure code change — a constant and a SQL clause with no DB dependency. The SQL-capture mock pattern is deterministic and covers the only observable contract: the constant value and its presence in the generated query string.

## Preconditions

- Working directory: `/home/keith/src/kodiai/.gsd/worktrees/M029`
- Bun installed and `bun test` available
- No DB or GitHub auth required

## Smoke Test

```
bun test src/knowledge/wiki-update-generator.test.ts
```

Expected: `26 pass, 0 fail` exits 0 in under 500ms.

## Test Cases

### 1. Constant value is exactly 3

1. Run `bun test src/knowledge/wiki-update-generator.test.ts --grep "MIN_HEURISTIC_SCORE"`
2. **Expected:** Test `MIN_HEURISTIC_SCORE > is set to 3 (High relevance threshold)` passes. Exit code 0.

Purpose: Prevents silent regression if the constant is changed to a different value.

---

### 2. Page-selection SQL includes the heuristic_score filter

1. Run `bun test src/knowledge/wiki-update-generator.test.ts --grep "heuristic_score"`
2. **Expected:** Test `createUpdateGenerator page selection > includes heuristic_score >= MIN_HEURISTIC_SCORE in the page-selection query` passes. The SQL-capture mock records that:
   - The query string contains `"heuristic_score >="`.
   - The interpolated parameter value is `3`.
   - Exit code 0.

Purpose: Proves the constant is wired into the actual SQL, not just defined.

---

### 3. All pre-existing tests remain green (no regression)

1. Run `bun test src/knowledge/wiki-update-generator.test.ts`
2. **Expected:** All 24 pre-existing tests pass. No test names changed. Total count: 26 pass, 0 fail. Exit code 0.

Purpose: Confirms the SQL change and import additions did not break any existing behavior.

---

### 4. MIN_HEURISTIC_SCORE is exported from the module

1. Run:
   ```
   bun -e "import { MIN_HEURISTIC_SCORE } from './src/knowledge/wiki-update-generator.ts'; console.log(MIN_HEURISTIC_SCORE);"
   ```
2. **Expected:** Prints `3` with exit code 0.

Purpose: Confirms the constant is importable by downstream consumers (S04 proof harness, future scripts).

---

### 5. MIN_OVERLAP_SCORE still present alongside new constant

1. Run:
   ```
   grep -n "MIN_OVERLAP_SCORE\|MIN_HEURISTIC_SCORE" src/knowledge/wiki-update-generator.ts
   ```
2. **Expected:** Both constants appear, with `MIN_HEURISTIC_SCORE` on the line immediately following `MIN_OVERLAP_SCORE`. Both lines are in the constants block near the top of the file (before any function definitions).

Purpose: Confirms naming consistency and placement match the plan.

---

## Edge Cases

### pageIds branch does not receive the filter

1. Run:
   ```
   grep -A 30 "pageIds" src/knowledge/wiki-update-generator.ts | grep "heuristic_score"
   ```
2. **Expected:** No output — the `pageIds` branch SQL does not contain `heuristic_score`. The filter only applies to the automatic page-selection `else` branch.

Purpose: Confirms the filter was not accidentally applied to the explicit-page-IDs path, which must remain unfiltered.

---

### Evidence-fetch query in processPage is untouched

1. Run:
   ```
   grep -c "heuristic_score" src/knowledge/wiki-update-generator.ts
   ```
2. **Expected:** Count is 2 (one for the constant definition, one for the SQL clause). If count is higher, the filter was accidentally added to other queries.

Purpose: Bounds the change to exactly the intended location.

---

## Failure Signals

- Test count `< 26` — some test was accidentally deleted or a new test failed to register.
- `MIN_HEURISTIC_SCORE > is set to 3` fails — constant was changed from 3.
- `includes heuristic_score >= MIN_HEURISTIC_SCORE` fails — SQL clause was removed, misspelled, or the mock didn't capture the right call.
- Any pre-existing test name fails — SQL change broke an existing test path.
- `grep` for `heuristic_score` in the file returns count > 2 — clause was accidentally duplicated.

## Not Proven By This UAT

- Runtime behavior: that rows with `heuristic_score < 3` are actually excluded from a live DB query — confirmed only by the mock-capture pattern, not a real DB execution.
- That the threshold value (3) is semantically correct for the wiki generation use case — this was a design decision made in M029 planning, not something a unit test can prove.
- S04's DB-level check (`NO-REASONING-IN-DB`) which operates on stored `wiki_update_suggestions` rows — that is proven by S04's proof harness.

## Notes for Tester

This is a mechanically simple slice. The two new tests are the complete proof surface. The SQL-capture mock is deterministic — it either records the expected string or it doesn't. If all 26 tests pass, S02 is fully verified.

The `pageIds` branch intentionally bypasses the threshold — do not flag this as a bug. It is a deliberate design decision documented in the slice summary.
