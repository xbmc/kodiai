---
phase: 68-multi-query-retrieval-core
plan: 01
subsystem: api
tags: [retrieval, deterministic-ranking, tdd]
requires:
  - phase: 52-intelligent-retrieval
    provides: base retrieval query/rerank conventions and score semantics
  - phase: 67-rate-limit-resilience-telemetry
    provides: fail-open reliability expectations for degraded enrichment paths
provides:
  - Pure multi-query variant generation for intent, file-path, and code-shape retrieval
  - Deterministic merge/rerank utility with stable tie-breakers and fail-open variant exclusion
  - Regression tests locking bounded output and ordering stability invariants
affects: [review-retrieval, mention-retrieval, retrieval-pipeline-wiring]
tech-stack:
  added: []
  patterns: [pure-function retrieval core, deterministic normalization plus stable tie-break ranking]
key-files:
  created: [src/learning/multi-query-retrieval.ts, src/learning/multi-query-retrieval.test.ts]
  modified: [src/learning/multi-query-retrieval.ts]
key-decisions:
  - "Normalize retrieval signals to lowercase collapsed-whitespace text to guarantee equivalent variant outputs across casing/spacing differences."
  - "Rank merged hits by aggregated weighted score with deterministic tie-breakers (distance, variant priority, stable key) so ordering is input-order independent."
patterns-established:
  - "Multi-query variant contract: always emit exactly three bounded variants in fixed order intent -> file-path -> code-shape."
  - "Fail-open merge contract: per-variant errors are ignored while successful variant hits still produce topK merged output."
duration: 2m21s
completed: 2026-02-17
---

# Phase 68 Plan 01: Deterministic Multi-Query Core Summary

**Deterministic multi-query retrieval utilities now emit bounded intent/file-path/code-shape queries and merge variant hits with stable fail-open ranking semantics.**

## Performance

- **Duration:** 2m21s
- **Started:** 2026-02-17T00:42:39Z
- **Completed:** 2026-02-17T00:45:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added a pure retrieval-core module with exported variant and merged-result types for downstream handler integration.
- Implemented bounded, normalized variant generation with fixed ordering and 800-character query caps.
- Implemented deterministic merged ranking with variant-level fail-open behavior and stable deduplication by memory identity or fallback fingerprint.
- Added RED->GREEN tests that lock variant bounds, semantic normalization equivalence, deterministic merge ordering, and partial-failure resilience.

## Task Commits

Each task was committed atomically:

1. **Task 1: Deterministic multi-query retrieval core (RED)** - `337a7aaed6` (test)
2. **Task 1: Deterministic multi-query retrieval core (GREEN)** - `6b352cada5` (feat)

## Files Created/Modified
- `src/learning/multi-query-retrieval.ts` - Pure utilities and types for variant construction and deterministic merged ranking.
- `src/learning/multi-query-retrieval.test.ts` - Regression suite for bounded variants, deterministic ordering, and fail-open merge behavior.

## Decisions Made
- Normalized all variant signal text to lowercase and collapsed whitespace for deterministic equivalence across semantically identical inputs.
- Preserved changed file-path order while bounding count to emphasize modified paths and keep retrieval prompts concise.
- Used weighted score aggregation plus deterministic tie-breakers to prevent input-array-order-dependent merge output.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- RET-07 algorithmic core is integration-ready for review and mention handlers in Plan 68-02.
- No blockers identified for wiring tasks.

---
*Phase: 68-multi-query-retrieval-core*
*Completed: 2026-02-17*

## Self-Check: PASSED

- FOUND: `.planning/phases/68-multi-query-retrieval-core/68-01-SUMMARY.md`
- FOUND: `337a7aaed6`
- FOUND: `6b352cada5`
