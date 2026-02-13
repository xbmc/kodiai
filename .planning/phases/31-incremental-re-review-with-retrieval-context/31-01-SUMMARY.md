---
phase: 31-incremental-re-review-with-retrieval-context
plan: 01
subsystem: knowledge
tags: [config, zod, sqlite, fnv1a, incremental-review, retrieval]

requires:
  - phase: 30-state-memory-and-isolation-foundation
    provides: run_state table with checkAndClaimRun/completeRun lifecycle
provides:
  - onSynchronize trigger config for pull_request.synchronize webhook events
  - knowledge.retrieval config sub-schema (enabled, topK, distanceThreshold, maxContextChars)
  - getLastReviewedHeadSha KnowledgeStore method
  - getPriorReviewFindings KnowledgeStore method returning unsuppressed findings with title fingerprints
affects: [31-02, 31-03, review-handler, webhook-handler]

tech-stack:
  added: []
  patterns:
    - "FNV-1a title fingerprinting duplicated in store.ts as _fingerprintTitle to avoid circular imports"
    - "Retrieval config nested under knowledge section with zod defaults"

key-files:
  created: []
  modified:
    - src/execution/config.ts
    - src/execution/config.test.ts
    - src/knowledge/types.ts
    - src/knowledge/store.ts
    - src/knowledge/store.test.ts

key-decisions:
  - "Duplicated FNV-1a fingerprint function in store.ts rather than extracting shared module (8-line pure function, avoids circular dependency with review.ts)"
  - "onSynchronize defaults to false (opt-in) since frequent pushes could generate expensive reviews"
  - "Retrieval enabled by default with conservative defaults (topK=5, distanceThreshold=0.3, maxContextChars=2000)"

patterns-established:
  - "_fingerprintTitle private helper pattern for title deduplication in KnowledgeStore"

duration: 3min
completed: 2026-02-13
---

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
