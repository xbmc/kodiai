---
id: S02
parent: M005
milestone: M005
provides:
  - computeIncrementalDiff function returning IncrementalDiffResult (mode incremental/full)
  - buildPriorFindingContext function partitioning findings by file change status
  - shouldSuppressFinding function for fingerprint-based duplicate detection
  - onSynchronize trigger config for pull_request.synchronize webhook events
  - knowledge.retrieval config sub-schema (enabled, topK, distanceThreshold, maxContextChars)
  - getLastReviewedHeadSha KnowledgeStore method
  - getPriorReviewFindings KnowledgeStore method returning unsuppressed findings with title fingerprints
  - Synchronize event registration for incremental re-reviews
  - Incremental diff computation wired into review handler (state-driven, not event-driven)
  - Prior finding dedup suppression via fingerprint matching on unchanged code
  - Retrieval context injection from learning memory into review prompt
  - buildIncrementalReviewSection and buildRetrievalContextSection prompt builder functions
requires: []
affects: []
key_files: []
key_decisions:
  - "Loosely coupled: computeIncrementalDiff accepts getLastReviewedHeadSha function instead of full KnowledgeStore"
  - "Fail-open: all git errors and exceptions degrade to mode=full rather than blocking review"
  - "Fingerprint-based dedup: filePath + titleFingerprint key for suppression matching"
  - "Duplicated FNV-1a fingerprint function in store.ts rather than extracting shared module (8-line pure function, avoids circular dependency with review.ts)"
  - "onSynchronize defaults to false (opt-in) since frequent pushes could generate expensive reviews"
  - "Retrieval enabled by default with conservative defaults (topK=5, distanceThreshold=0.3, maxContextChars=2000)"
  - "Incremental mode is state-driven (based on prior completed review existence), not event-driven -- works for both synchronize and review_requested"
  - "reviewFiles filtered for prompt context, changedFiles preserved for Review Details metrics and diff analysis"
  - "Combined suppression: both config-based suppression AND dedup-based fingerprint suppression checked per finding"
  - "Isolation layer created in index.ts and injected via deps (consistent with learningMemoryStore pattern)"
patterns_established:
  - "Fail-open git operations: wrap in try/catch, return degraded result on any error"
  - "File-change partitioning: findings on changed files re-evaluated, unchanged files suppressed"
  - "_fingerprintTitle private helper pattern for title deduplication in KnowledgeStore"
  - "Incremental review file filtering: reviewFiles = changedFiles intersected with incrementalSet"
  - "Combined suppression check: config suppressions OR dedup fingerprint suppression"
observability_surfaces: []
drill_down_paths: []
duration: 4min
verification_result: passed
completed_at: 2026-02-13
blocker_discovered: false
---
# S02: Incremental Re Review With Retrieval Context

**# Phase 31 Plan 02: Incremental Diff and Finding Dedup Summary**

## What Happened

# Phase 31 Plan 02: Incremental Diff and Finding Dedup Summary

**Stateless utility modules for incremental diff computation with fail-open git operations and fingerprint-based finding deduplication**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-13T07:46:43Z
- **Completed:** 2026-02-13T07:49:13Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created `computeIncrementalDiff` with full fail-open chain: no prior review, unreachable SHA (with deepen attempt), diff failure, and unexpected error all degrade to full review
- Created `buildPriorFindingContext` to partition prior findings into unchanged-code context vs suppression fingerprints
- Created `shouldSuppressFinding` for simple fingerprint-based duplicate lookup
- 9 tests covering all unit-testable paths (git-dependent paths deferred to integration tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create incremental diff computation module** - `026470eb9d` (feat)
2. **Task 2: Create finding deduplication module** - `31e756c0e3` (feat)

## Files Created/Modified
- `src/lib/incremental-diff.ts` - Computes files changed between last reviewed head SHA and current HEAD with fail-open semantics
- `src/lib/incremental-diff.test.ts` - 4 unit tests for null SHA, type shape, invalid workspace, thrown exceptions
- `src/lib/finding-dedup.ts` - Partitions prior findings by file change status and provides suppression fingerprint lookup
- `src/lib/finding-dedup.test.ts` - 5 unit tests for empty context, unchanged/changed file partitioning, fingerprint matching

## Decisions Made
- Used function parameter (`getLastReviewedHeadSha`) instead of full `KnowledgeStore` to keep `computeIncrementalDiff` loosely coupled and testable without database setup
- Fail-open chain: entire function body wrapped in try/catch with mode=full fallback on any unexpected error
- Finding dedup uses `filePath:titleFingerprint` composite key in a Set for O(1) suppression lookup

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both modules are ready for consumption by Plan 03 (review handler wiring)
- `computeIncrementalDiff` returns `IncrementalDiffResult` with `changedFilesSinceLastReview` array
- `buildPriorFindingContext` returns `PriorFindingContext` with `suppressionFingerprints` Set
- `shouldSuppressFinding` provides the per-finding check the review handler will use

## Self-Check: PASSED

All 4 created files verified on disk. Both commit hashes (026470eb9d, 31e756c0e3) found in git log. 336 tests pass, build succeeds.

---
*Phase: 31-incremental-re-review-with-retrieval-context*
*Completed: 2026-02-13*

# Phase 31 Plan 01: Config Schema + KnowledgeStore Queries Summary

**onSynchronize trigger config and getLastReviewedHeadSha/getPriorReviewFindings KnowledgeStore methods for incremental re-review**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-13T07:46:24Z
- **Completed:** 2026-02-13T07:49:21Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Extended config schema with `review.triggers.onSynchronize` (default false) for opt-in synchronize event handling
- Added `knowledge.retrieval` sub-schema with enabled, topK, distanceThreshold, maxContextChars settings
- Implemented `getLastReviewedHeadSha` returning the head SHA of the last completed run for a repo+PR
- Implemented `getPriorReviewFindings` returning unsuppressed findings with FNV-1a title fingerprints from latest completed review
- All 336 tests green, build compiles without errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend config schema with onSynchronize trigger and retrieval settings** - `4dd827e5f7` (feat)
2. **Task 2: Add getLastReviewedHeadSha and getPriorReviewFindings to KnowledgeStore** - `cedc725180` (feat)

## Files Created/Modified
- `src/execution/config.ts` - Added onSynchronize to reviewTriggersSchema, added retrievalSchema to knowledgeSchema
- `src/execution/config.test.ts` - 3 new tests + updated existing trigger test for onSynchronize
- `src/knowledge/types.ts` - Added PriorFinding type, two new method signatures on KnowledgeStore
- `src/knowledge/store.ts` - Added prepared statements, _fingerprintTitle helper, and two new method implementations
- `src/knowledge/store.test.ts` - 4 new tests for incremental re-review queries

## Decisions Made
- Duplicated FNV-1a fingerprint as `_fingerprintTitle` in store.ts rather than creating a shared module, avoiding circular dependency with review.ts for an 8-line pure function
- onSynchronize defaults to false (opt-in) per research recommendation about frequent push costs
- Retrieval enabled by default with conservative defaults for immediate usability

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing trigger test expecting onSynchronize as unknown key**
- **Found during:** Task 1
- **Issue:** Existing test "strips unknown review.triggers keys without error" used `onSynchronize: true` as the unknown key to test stripping, but onSynchronize is now a valid schema field
- **Fix:** Changed test to use `onFutureEvent: true` as the unknown key instead; also updated "parses review.triggers from YAML" test to include `onSynchronize: false` in expected object
- **Files modified:** src/execution/config.test.ts
- **Verification:** All 60 config tests pass
- **Committed in:** 4dd827e5f7 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary test update for backward compatibility. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Config schema and KnowledgeStore queries ready for Plan 02 (review handler wiring for synchronize events)
- Plan 03 can use retrieval config and getPriorReviewFindings for context-enriched re-reviews

---
*Phase: 31-incremental-re-review-with-retrieval-context*
*Completed: 2026-02-13*

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
