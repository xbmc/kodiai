---
id: S05
parent: M020
milestone: M020
provides:
  - "Executor wired with taskRouter and costTracker dependencies"
  - "Wiki staleness detector LLM calls produce cost rows (repo field fix)"
requires: []
affects: []
key_files: []
key_decisions:
  - "Kept separate stalenessTaskRouter and clusterTaskRouter for scheduled jobs; added shared taskRouter only for executor"
  - "costTracker created once from telemetryStore, shared across executor and staleness detector"
patterns_established:
  - "All LLM consumers must receive both costTracker and repo to produce cost rows"
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-02-26
blocker_discovered: false
---
# S05: Wire Executor Deps Cost Tracking

**# Phase 101 Plan 1: Wire Executor Deps and Cost Tracking Summary**

## What Happened

# Phase 101 Plan 1: Wire Executor Deps and Cost Tracking Summary

**Wired taskRouter + costTracker into createExecutor and fixed missing repo field in wiki staleness generateWithFallback call**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-26T08:31:47Z
- **Completed:** 2026-02-26T08:34:18Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Executor now receives taskRouter and costTracker, enabling .kodiai.yml model routing and cost row writes for agentic tasks (GAP-1 closed)
- Wiki staleness detector generateWithFallback call now includes repo field, so cost tracking guard passes (GAP-2 closed)
- All existing tests pass with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire taskRouter and costTracker into createExecutor in index.ts** - `23b40c6b1d` (feat)
2. **Task 2: Fix missing repo field in wiki-staleness-detector generateWithFallback call** - `f213662062` (fix)

## Files Created/Modified
- `src/index.ts` - Added createCostTracker import, shared costTracker + taskRouter instances, wired into createExecutor and createWikiStalenessDetector
- `src/knowledge/wiki-staleness-detector.ts` - Added repo field to generateWithFallback call using githubOwner/githubRepo

## Decisions Made
- Kept separate stalenessTaskRouter and clusterTaskRouter for scheduled background jobs (they use empty model config for default routing); the shared taskRouter for the executor also starts with empty config since per-repo .kodiai.yml overrides are applied inside the executor at runtime
- costTracker is created once from telemetryStore and shared, matching the existing pattern for other shared dependencies

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both integration gaps (GAP-1 and GAP-2) closed
- All LLM invocations (agentic and non-agentic) now produce cost rows when costTracker is available
- Ready for phase 102 or further gap closure work

---
*Phase: 101-wire-executor-deps-cost-tracking*
*Completed: 2026-02-26*
