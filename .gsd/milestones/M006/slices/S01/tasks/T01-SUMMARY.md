---
id: T01
parent: S01
milestone: M006
provides:
  - run_state SQLite table with UNIQUE constraint on run_key for durable idempotency
  - RunStatus, RunStateCheck, RunStateRecord types
  - checkAndClaimRun, completeRun, purgeOldRuns methods on KnowledgeStore
  - SHA-keyed run identity integrated into review handler before workspace creation
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-13
blocker_discovered: false
---
# T01: 30-state-memory-and-isolation-foundation 01

**# Phase 30 Plan 01: Run State Idempotency Summary**

## What Happened

# Phase 30 Plan 01: Run State Idempotency Summary

**Durable SHA-keyed run state table in KnowledgeStore with review handler integration for idempotent webhook processing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-13T07:13:45Z
- **Completed:** 2026-02-13T07:17:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- run_state SQLite table with UNIQUE constraint on run_key for durable, restart-surviving idempotency
- checkAndClaimRun uses transactional claim-or-skip with automatic force-push supersession
- Review handler skips duplicate SHA pairs before expensive workspace creation
- completeRun called after successful review for audit trail
- Full test coverage: 6 new run state tests, all 312 project tests green

## Task Commits

Each task was committed atomically:

1. **Task 1: Add run_state table and RunState API to KnowledgeStore** - `3cf2a8826f` (feat)
2. **Task 2: Integrate run state idempotency into review handler** - `2780dd3c95` (feat)

## Files Created/Modified
- `src/knowledge/types.ts` - Added RunStatus, RunStateCheck, RunStateRecord types and KnowledgeStore interface methods
- `src/knowledge/store.ts` - Added run_state table creation, prepared statements, checkAndClaimRun/completeRun/purgeOldRuns implementations
- `src/knowledge/store.test.ts` - Added 6 run state tests (new, duplicate, supersede, complete, purge, delivery-id-independence)
- `src/handlers/review.ts` - Added early run state check before workspace creation and completeRun after knowledge store recording

## Decisions Made
- Run identity keyed by SHA pair (base+head), not delivery ID, so GitHub retries for the same SHA pair are caught as duplicates
- Run state check placed inside job callback (not before enqueue) for serialized access to SQLite
- Fail-open design: if knowledgeStore is undefined or SQLite query throws, review proceeds normally
- Existing marker-based idempotency (ensureReviewOutputNotPublished) retained as defense-in-depth for DB migration scenarios
- Superseded runs purged after 7 days, completed runs after 30 days (default, configurable via purgeOldRuns parameter)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Run state infrastructure ready for 30-02 (embedding storage) and 30-03 (isolation boundaries)
- purgeOldRuns available for startup lifecycle integration (e.g., alongside existing telemetryStore.purgeOlderThan)
- In-memory webhook deduplicator (src/webhook/dedup.ts) intentionally preserved for non-review event dedup

## Self-Check: PASSED

All files exist and all commits verified.

---
*Phase: 30-state-memory-and-isolation-foundation*
*Completed: 2026-02-13*
