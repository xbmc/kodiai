---
phase: 57-analysis-layer
plan: "02"
subsystem: learning
tags: [retrieval, recency, decay, bun, typescript]

# Dependency graph
requires: []
provides:
  - Post-rerank recency weighting for retrieval results (severity-aware decay floors)
affects: [retrieval, learning-memories]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Pure post-processing function over RerankedResult[]
    - Exponential half-life decay with severity-aware floor

key-files:
  created:
    - src/learning/retrieval-recency.ts
    - src/learning/retrieval-recency.test.ts
  modified: []

key-decisions:
  - "None - followed plan as specified"

patterns-established:
  - "Recency weighting: adjustedDistance * (2 - multiplier) with sorted output"

# Metrics
duration: 0 min
completed: 2026-02-15
---

# Phase 57 Plan 02: Retrieval Recency Weighting Summary

**Exponential recency decay (90d half-life) applied after language reranking, with severity-aware floors so CRITICAL/MAJOR memories never fully fade.**

## Performance

- **Duration:** 0 min
- **Started:** 2026-02-15T20:04:02Z
- **Completed:** 2026-02-15T20:04:27Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Added `applyRecencyWeighting` to adjust `adjustedDistance` based on memory age, re-sorting output by best matches
- Implemented severity-aware decay floors (0.3 for critical/major, 0.15 for medium/minor) to prevent forgetting high-severity issues
- Added unit tests covering ordering, decay floors, missing timestamps, and non-mutation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create retrieval recency weighting module** - `9ad99566ad` (feat)

**Plan metadata:** Recorded in the final `docs(57-02)` metadata commit.

## Files Created/Modified

- `src/learning/retrieval-recency.ts` - Recency weighting function and default config
- `src/learning/retrieval-recency.test.ts` - Unit tests for decay, floors, sorting, and purity

## Decisions Made

None - followed plan as specified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used `minor` severity for non-critical test case**
- **Found during:** Task 1 (Create retrieval recency weighting module)
- **Issue:** Plan referenced a "suggestion" severity, but `FindingSeverity` only allows `critical|major|medium|minor`
- **Fix:** Updated the non-critical floor test to use `minor` severity while preserving the intended behavior check (0.15 floor)
- **Files modified:** src/learning/retrieval-recency.test.ts
- **Verification:** `bun test src/learning/retrieval-recency.test.ts`, `bun test`
- **Committed in:** `9ad99566ad`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope change; adjustment was required to align with existing severity taxonomy.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Recency weighting module is ready to be chained after `rerankByLanguage`
- Unit tests are in place to prevent regressions in decay math, floors, and sorting

---
*Phase: 57-analysis-layer*
*Completed: 2026-02-15*

## Self-Check: PASSED

- FOUND: `.planning/phases/57-analysis-layer/57-02-SUMMARY.md`
- FOUND: `src/learning/retrieval-recency.ts`
- FOUND: `src/learning/retrieval-recency.test.ts`
- FOUND COMMIT: `9ad99566ad`
