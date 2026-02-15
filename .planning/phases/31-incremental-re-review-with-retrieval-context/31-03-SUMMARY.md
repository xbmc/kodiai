---
phase: 31-incremental-re-review-with-retrieval-context
plan: 03
subsystem: handlers
tags: [incremental-review, retrieval, dedup, synchronize, fail-open, prompt-builder]

requires:
  - phase: 31-incremental-re-review-with-retrieval-context plan 01
    provides: onSynchronize config, retrieval config, getLastReviewedHeadSha, getPriorReviewFindings
  - phase: 31-incremental-re-review-with-retrieval-context plan 02
    provides: computeIncrementalDiff, buildPriorFindingContext, shouldSuppressFinding
  - phase: 30-state-memory-and-isolation-foundation
    provides: run_state lifecycle, learning memory store, isolation layer, embedding provider
provides:
  - Synchronize event registration for incremental re-reviews
  - Incremental diff computation wired into review handler (state-driven, not event-driven)
  - Prior finding dedup suppression via fingerprint matching on unchanged code
  - Retrieval context injection from learning memory into review prompt
  - buildIncrementalReviewSection and buildRetrievalContextSection prompt builder functions
affects: [review-handler, prompt-builder, webhook-pipeline]

tech-stack:
  added: []
  patterns:
    - "Fail-open integration: every new code path (incremental, dedup, retrieval) wrapped in try/catch"
    - "State-driven incremental mode: both synchronize and review_requested use same logic"
    - "reviewFiles filtered subset for prompt, changedFiles preserved for metrics"

key-files:
  created: []
  modified:
    - src/execution/review-prompt.ts
    - src/handlers/review.ts
    - src/index.ts

key-decisions:
  - "Incremental mode is state-driven (based on prior completed review existence), not event-driven -- works for both synchronize and review_requested"
  - "reviewFiles filtered for prompt context, changedFiles preserved for Review Details metrics and diff analysis"
  - "Combined suppression: both config-based suppression AND dedup-based fingerprint suppression checked per finding"
  - "Isolation layer created in index.ts and injected via deps (consistent with learningMemoryStore pattern)"

patterns-established:
  - "Incremental review file filtering: reviewFiles = changedFiles intersected with incrementalSet"
  - "Combined suppression check: config suppressions OR dedup fingerprint suppression"

duration: 4min
completed: 2026-02-13
---

# Phase 31 Plan 03: Review Handler Wiring Summary

**Wired incremental diff, finding dedup, and learning retrieval context into the live review handler with fail-open semantics for all new paths**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-13T07:51:50Z
- **Completed:** 2026-02-13T07:55:49Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `buildIncrementalReviewSection` and `buildRetrievalContextSection` to the review prompt builder with bounded output
- Extended `buildReviewPrompt` with optional `incrementalContext` and `retrievalContext` parameters (backward compatible)
- Wired incremental diff computation, prior finding dedup, and retrieval context into the review handler
- Registered `pull_request.synchronize` event handler gated by `onSynchronize` config
- Combined config-based suppression with fingerprint-based dedup suppression for finding filtering
- Created isolation layer in index.ts and injected into review handler
- All 336 tests pass, build compiles without errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add incremental review and retrieval context sections to the review prompt builder** - `91da1846bd` (feat)
2. **Task 2: Wire synchronize event, incremental diff, dedup, and retrieval into review handler** - `432ab38675` (feat)

## Files Created/Modified
- `src/execution/review-prompt.ts` - Added buildIncrementalReviewSection, buildRetrievalContextSection, extended buildReviewPrompt context type
- `src/handlers/review.ts` - Added PullRequestSynchronizeEvent handling, incremental diff, file filtering, dedup context, retrieval context, synchronize event registration
- `src/index.ts` - Created IsolationLayer instance, passed to createReviewHandler

## Decisions Made
- Incremental mode is state-driven (checks for prior completed review), not event-driven -- same logic applies to both synchronize and review_requested events
- reviewFiles is a filtered subset used for the prompt builder; changedFiles is preserved for Review Details metrics and diff analysis
- Combined suppression: both existing config-based suppression and new dedup-based fingerprint suppression are checked per finding
- Isolation layer follows the same dependency injection pattern as learningMemoryStore

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 31 complete: incremental re-review with retrieval context is fully wired
- Synchronize events trigger incremental reviews when onSynchronize is enabled
- Prior findings on unchanged code are suppressed via fingerprint matching
- Learning memory retrieval enriches review prompts with similar prior findings
- All paths are fail-open: errors degrade gracefully without blocking review publication

## Self-Check: PASSED

All 3 modified files verified on disk. Both commit hashes (91da1846bd, 432ab38675) found in git log. 336 tests pass, build succeeds. Key patterns verified: synchronize event registered, incremental/retrieval sections exported, isolation layer wired.

---
*Phase: 31-incremental-re-review-with-retrieval-context*
*Completed: 2026-02-13*
