---
id: T02
parent: S02
milestone: M040
key_files:
  - src/lib/file-risk-scorer.ts
  - src/lib/file-risk-scorer.test.ts
  - src/handlers/review.ts
  - .gsd/milestones/M040/slices/S02/tasks/T02-SUMMARY.md
key_decisions:
  - Kept graph-aware selection as an optional fail-open reranking step over existing file-risk scores instead of making review execution depend on graph availability.
  - Recorded graph influence via structured large-PR log fields rather than introducing a new telemetry schema in this task.
duration: 
verification_result: passed
completed_at: 2026-04-05T10:25:13.542Z
blocker_discovered: false
---

# T02: Added graph-aware reranking to extensive-review file selection and logged graph-hit selection counters for large PRs.

**Added graph-aware reranking to extensive-review file selection and logged graph-hit selection counters for large PRs.**

## What Happened

Extended the file-risk scorer with an optional graph-aware reranking layer that boosts impacted files and likely tests from persisted review-graph blast-radius results while preserving the existing non-graph fallback path. Wired the review handler to call an optional injected reviewGraphQuery before large-PR triage, fail open on query errors, and feed the reranked list into the existing bounded full/abbreviated/mention-only selection logic. Added focused scorer tests covering fallback preservation, graph-backed promotion, likely-test score boosts, and ignored out-of-scope graph paths.

## Verification

Ran the task verification command `bun test ./src/lib/file-risk-scorer.test.ts` and a targeted integration/type-safety check with `bun run tsc --noEmit`. Both passed after tightening the graph-selection scoring assertions to match the bounded reranking contract.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/lib/file-risk-scorer.test.ts` | 0 | ✅ pass | 23ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 0ms |

## Deviations

Used an optional `reviewGraphQuery` dependency injection seam on the review handler instead of adding a new config surface or hard-coding store access in this task. This kept the implementation local and fail-open while enabling real graph-aware selection when a query provider is supplied.

## Known Issues

Production review execution will remain on the fallback file-risk path until the persisted review-graph query function is passed into the review handler wiring. The new seam and observability are in place, but the provider hookup is separate work.

## Files Created/Modified

- `src/lib/file-risk-scorer.ts`
- `src/lib/file-risk-scorer.test.ts`
- `src/handlers/review.ts`
- `.gsd/milestones/M040/slices/S02/tasks/T02-SUMMARY.md`
