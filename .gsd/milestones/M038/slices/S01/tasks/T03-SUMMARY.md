---
id: T03
parent: S01
milestone: M038
key_files:
  - src/structural-impact/review-integration.ts
  - src/structural-impact/review-integration.test.ts
  - src/handlers/review.ts
  - .gsd/milestones/M038/slices/S01/tasks/T03-SUMMARY.md
key_decisions:
  - Localized graph/corpus substrate wiring behind fetchReviewStructuralImpact instead of expanding direct substrate calls in review.ts
  - Preserved the existing prompt contract by returning captured ReviewGraphBlastRadiusResult alongside the bounded payload
  - Kept corpus failure behavior aligned with existing canonical search fail-open semantics: empty matches instead of new handler-visible errors
duration: 
verification_result: passed
completed_at: 2026-04-05T19:14:12.201Z
blocker_discovered: false
---

# T03: Added a review-facing structural-impact integration seam and wired review.ts to consume it for graph-aware file selection without direct substrate calls.

**Added a review-facing structural-impact integration seam and wired review.ts to consume it for graph-aware file selection without direct substrate calls.**

## What Happened

Created src/structural-impact/review-integration.ts as the single review-path boundary for structural-impact retrieval. The module builds concrete graph/corpus adapters from existing M040/M041 entrypoints, delegates timeout/cache/degradation handling to fetchStructuralImpact, and returns both bounded StructuralImpactPayload and captured ReviewGraphBlastRadiusResult so the current review prompt path can remain stable. Updated src/handlers/review.ts to replace the direct reviewGraphQuery call in the large-PR graph-aware selection path with fetchReviewStructuralImpact. Added src/structural-impact/review-integration.test.ts with stubbed graph/corpus tests for adapter delegation, happy path, fail-open graph/corpus behavior, timeout degradation, cache reuse, and signal forwarding.

## Verification

Ran bun test ./src/structural-impact/review-integration.test.ts with 9 passing tests and then bun run tsc --noEmit with a clean exit after wiring the new seam into src/handlers/review.ts.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/structural-impact/review-integration.test.ts` | 0 | ✅ pass | 20ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 1000ms |

## Deviations

Returned both bounded StructuralImpactPayload and raw ReviewGraphBlastRadiusResult from the new seam so review.ts can migrate incrementally without changing the existing prompt contract in this task.

## Known Issues

Canonical corpus retrieval is implemented and tested in the integration seam, but review.ts does not yet consume the bounded canonical evidence downstream for prompt/context assembly.

## Files Created/Modified

- `src/structural-impact/review-integration.ts`
- `src/structural-impact/review-integration.test.ts`
- `src/handlers/review.ts`
- `.gsd/milestones/M038/slices/S01/tasks/T03-SUMMARY.md`
