---
id: S02
parent: M010
milestone: M010
provides:
  - Workspace usage evidence extractor for package imports/API identifiers (DEP-04)
  - Scoped multi-package coordination detector (DEP-06)
  - Post-rerank recency weighting for retrieval results (severity-aware decay floors)
  - Dep bump context enriched with workspace usage evidence (fail-open, 3s budget)
  - Group bump scope coordination detection and prompt rendering
  - Retrieval reranking applies recency weighting after language rerank, with telemetry based on final distances
requires: []
affects: []
key_files: []
key_decisions:
  - "Expose a test-only grep runner hook to make timeout behavior deterministic in unit tests."
  - "None - followed plan as specified"
  - "Added optional dependency injection hooks in createReviewHandler for deterministic unit tests (no behavior change in production)."
patterns_established:
  - "Pure analysis modules in src/lib/ with bun:test unit coverage"
  - "Recency weighting: adjustedDistance * (2 - multiplier) with sorted output"
  - "Dep bump enrichments: usage analysis (breaking-change gated) -> scope coordination (group gated) -> prompt rendering"
  - "Retrieval rerank pipeline: rerankByLanguage -> applyRecencyWeighting -> telemetry/prompt"
observability_surfaces: []
drill_down_paths: []
duration: 11 min
verification_result: passed
completed_at: 2026-02-15
blocker_discovered: false
---
# S02: Analysis Layer

**# Phase 57 Plan 01: Usage Analyzer + Scope Coordinator Summary**

## What Happened

# Phase 57 Plan 01: Usage Analyzer + Scope Coordinator Summary

**Workspace-aware usage evidence extraction via `git grep` with a hard time budget, plus deterministic scope coordination grouping for scoped packages.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-15T20:00:56Z
- **Completed:** 2026-02-15T20:07:43Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `analyzePackageUsage()` to extract file:line evidence for imports/usage of a package and breaking-change APIs, with a Promise.race time budget and fail-open behavior.
- Added `detectScopeCoordination()` to group scoped packages by scope prefix when 2+ are present, returning deterministic output.
- Covered both modules with bun:test unit tests (including timeout behavior and edge cases).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create usage analyzer module** - `f978ae26e7` (feat)
2. **Task 2: Create scope coordinator module** - `1c63731960` (feat)

**Plan metadata:** (docs commit created after SUMMARY + STATE updates)

## Files Created/Modified

- `src/lib/usage-analyzer.ts` - Greps a workspace with `git grep` for package/API usage evidence under a time budget.
- `src/lib/usage-analyzer.test.ts` - Tests search term extraction, output parsing, fail-open behavior, and timeout handling.
- `src/lib/scope-coordinator.ts` - Pure function grouping scoped packages by `@scope` with 2+ members.
- `src/lib/scope-coordinator.test.ts` - Tests grouping behavior and empty/non-scoped cases.

## Decisions Made

- Exposed a test-only `__runGrepForTests` hook in `analyzePackageUsage()` to test timeouts deterministically without relying on slow/fragile real subprocess behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Analysis primitives are ready to be wired into the dep bump review handler and prompt rendering in subsequent Phase 57 plans.

---
*Phase: 57-analysis-layer*
*Completed: 2026-02-15*

## Self-Check: PASSED

- Summary file exists: `.planning/phases/57-analysis-layer/57-01-SUMMARY.md`
- Task commits present: `f978ae26e7`, `1c63731960`

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

# Phase 57 Plan 03: Review Wiring Summary

**Dependency bump reviews now surface workspace usage evidence + multi-package coordination, and retrieval reranking applies recency weighting after language rerank with telemetry aligned to the final results.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-02-15T20:10:59Z
- **Completed:** 2026-02-15T20:22:57Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Wired workspace usage analysis (3s budget, fail-open) into the dep bump enrichment pipeline and surfaced evidence in the review prompt.
- Added scoped-package coordination detection for group bumps and rendered coordination groups in the dep bump context.
- Chained retrieval recency weighting after language reranking and ensured retrieval quality telemetry reflects the final post-recency distances.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire usage analysis and scope coordination into dep bump pipeline** - `cbc5797805` (feat)
2. **Task 2: Wire recency weighting into retrieval pipeline** - `48d18365ef` (feat)

**Plan metadata:** (docs commit created after SUMMARY + STATE updates)

## Files Created/Modified

- `src/lib/dep-bump-detector.ts` - Extends `DepBumpContext` to carry `usageEvidence` and `scopeGroups` for prompt rendering.
- `src/handlers/review.ts` - Runs breaking-change-gated usage analysis and group-bump scope coordination; applies recency weighting after language rerank.
- `src/execution/review-prompt.ts` - Renders `### Workspace Usage Evidence` and `### Multi-Package Coordination` sections in dependency bump context.
- `src/handlers/review.test.ts` - Adds focused wiring tests for usage analysis fail-open behavior and recency-weighting call order/telemetry.
- `src/execution/review-prompt.test.ts` - Adds prompt rendering coverage for usage evidence and scope coordination sections.

## Decisions Made

- Added optional dependency injection hooks in `createReviewHandler` for deterministic unit tests (keeps production defaults via direct imports).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 57 analysis wiring is complete; ready to proceed to Phase 58 (adaptive thresholds) and Phase 59 (timeout checkpoints/retry) planning/execution.

---
*Phase: 57-analysis-layer*
*Completed: 2026-02-15*

## Self-Check: PASSED

- FOUND: `.planning/phases/57-analysis-layer/57-03-SUMMARY.md`
- FOUND COMMIT: `cbc5797805`
- FOUND COMMIT: `48d18365ef`
