---
phase: 97-multi-llm-routing-cost-tracking
plan: 02
subsystem: telemetry
tags: [postgres, migration, cost-tracking, llm, telemetry]

requires:
  - phase: 97-01
    provides: Pricing config and estimateCost function
provides:
  - llm_cost_events Postgres table with full-dimensional schema
  - LlmCostRecord type for cost tracking
  - CostTracker module with trackAiSdkCall and trackAgentSdkCall
  - TelemetryStore.recordLlmCost() method
affects: [97-03, execution, telemetry]

tech-stack:
  added: []
  patterns: [fire-and-forget-telemetry, fail-open-cost-tracking]

key-files:
  created:
    - src/db/migrations/010-llm-cost-events.sql
    - src/db/migrations/010-llm-cost-events.down.sql
    - src/llm/cost-tracker.ts
  modified:
    - src/telemetry/types.ts
    - src/telemetry/store.ts
    - src/llm/index.ts

key-decisions:
  - "Cost tracker methods are fire-and-forget, never throw"
  - "Agent SDK cost uses provided costUsd when available, falls back to estimateCost"

patterns-established:
  - "Fire-and-forget cost tracking that never blocks execution"

requirements-completed: [LLM-05]

duration: 2min
completed: 2026-02-26
---

# Phase 97 Plan 02: Cost Tracking Storage Summary

**Postgres migration for llm_cost_events with fire-and-forget CostTracker module for per-invocation cost visibility**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-26T01:45:17Z
- **Completed:** 2026-02-26T01:47:10Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created migration 010 with llm_cost_events table and 5 indexes
- Added LlmCostRecord type to telemetry types
- Implemented recordLlmCost in TelemetryStore with fail-open error handling
- Built CostTracker module with trackAiSdkCall and trackAgentSdkCall
- Extended purgeOlderThan to include llm_cost_events cleanup

## Task Commits

1. **Task 1: Create llm_cost_events migration and LlmCostRecord type** - `52caa11f` (feat)
2. **Task 2: Implement recordLlmCost in telemetry store and create cost tracker module** - `509af3db` (feat)

## Files Created/Modified
- `src/db/migrations/010-llm-cost-events.sql` - llm_cost_events table with indexes
- `src/db/migrations/010-llm-cost-events.down.sql` - Rollback migration
- `src/llm/cost-tracker.ts` - CostTracker factory with AI SDK and Agent SDK tracking
- `src/telemetry/types.ts` - LlmCostRecord type and recordLlmCost method
- `src/telemetry/store.ts` - recordLlmCost implementation and purge extension
- `src/llm/index.ts` - Added cost tracker exports

## Decisions Made
- Cost tracker methods are fire-and-forget, never throw (fail-open philosophy)
- Agent SDK tracking uses provided costUsd from resultMessage when available

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Cost tracking infrastructure complete, ready for Plan 03 wiring
- CostTracker available via src/llm/index.ts barrel

---
*Phase: 97-multi-llm-routing-cost-tracking*
*Completed: 2026-02-26*
