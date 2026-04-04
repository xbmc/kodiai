---
id: T03
parent: S02
milestone: M035
key_files:
  - src/knowledge/retrieval.test.ts
key_decisions:
  - Use a baseline-vs-reranked comparison in the reorder test instead of assuming the pre-rerank RRF ordering from fixture distances alone.
  - Guard the regression contract with explicit `provenance.rerankApplied` assertions in both success and fail-open paths.
duration: 
verification_result: passed
completed_at: 2026-04-04T16:42:21.047Z
blocker_discovered: false
---

# T03: Added retrieval regressions for rerank ordering, null-return fail-open behavior, and absent-provider behavior.

**Added retrieval regressions for rerank ordering, null-return fail-open behavior, and absent-provider behavior.**

## What Happened

Extended `src/knowledge/retrieval.test.ts` with a local `makeMockRerankProvider()` helper and three rerank-focused regression tests. The success-path test first captures the baseline RRF order from the same fixture set, then injects a rerank provider that reverses the returned indices and verifies that `unifiedResults` reorder to the reversed baseline, `rerankScore` is attached by rank position, and `provenance.rerankApplied` becomes `true`. Added two fail-open regressions: one for the no-op/null-return provider path and one for the absent-provider path, both asserting that retrieval still succeeds and `rerankApplied` remains `false`. During verification, Bun tests passed before the type gate surfaced a dropped `RerankProvider` import; that import was restored and the final combined verification run passed cleanly.

## Verification

Final state verification passes end-to-end: `bun test ./src/knowledge/runtime.test.ts`, `bun test ./src/knowledge/retrieval.test.ts`, and `bun run tsc --noEmit` all succeed from the same working tree.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/runtime.test.ts && bun test ./src/knowledge/retrieval.test.ts && bun run tsc --noEmit` | 0 | ✅ pass | 6500ms |

## Deviations

The first test pass exposed two planning-to-implementation gaps: the local rerank helper import and helper insertion did not survive the initial exact-replace edits, and the final slice verification caught one dropped `RerankProvider` type import in `retrieval.test.ts`. Both were corrected before the final verification run.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/retrieval.test.ts`
