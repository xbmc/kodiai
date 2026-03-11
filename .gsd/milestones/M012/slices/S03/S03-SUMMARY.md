---
id: S03
parent: M012
milestone: M012
provides:
  - Multi-query retrieval orchestration in review execution with bounded variant concurrency
  - Mention-surface retrieval enrichment using the same variant merge contract
  - Deterministic, fail-open retrieval regressions across review and mention flows
  - Pure multi-query variant generation for intent, file-path, and code-shape retrieval
  - Deterministic merge/rerank utility with stable tie-breakers and fail-open variant exclusion
  - Regression tests locking bounded output and ordering stability invariants
requires: []
affects: []
key_files: []
key_decisions:
  - "Run retrieval variants with a bounded concurrency of 2 and a shared topK budget split across variants to preserve latency guardrails."
  - "Keep retrieval fail-open at variant granularity for review and mention: continue with successful variants and drop context only when all variants fail."
  - "Limit mention retrieval prompt context to at most three merged findings to keep replies concise while still grounded."
  - "Normalize retrieval signals to lowercase collapsed-whitespace text to guarantee equivalent variant outputs across casing/spacing differences."
  - "Rank merged hits by aggregated weighted score with deterministic tie-breakers (distance, variant priority, stable key) so ordering is input-order independent."
patterns_established:
  - "Multi-query orchestration pattern: build variants -> execute per variant -> merge deterministically -> continue pipeline"
  - "Prompt enrichment pattern: inject retrieval context as optional section without blocking execution"
  - "Multi-query variant contract: always emit exactly three bounded variants in fixed order intent -> file-path -> code-shape."
  - "Fail-open merge contract: per-variant errors are ignored while successful variant hits still produce topK merged output."
observability_surfaces: []
drill_down_paths: []
duration: 2m21s
verification_result: passed
completed_at: 2026-02-17
blocker_discovered: false
---
# S03: Multi Query Retrieval Core

**# Phase 68 Plan 02: Multi-query retrieval integration Summary**

## What Happened

# Phase 68 Plan 02: Multi-query retrieval integration Summary

**Review and mention production paths now run bounded multi-query retrieval variants, merge results deterministically, and keep user responses fail-open on variant errors.**

## Performance

- **Duration:** 7m32s
- **Started:** 2026-02-17T00:45:55Z
- **Completed:** 2026-02-17T00:53:27Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Replaced review retrieval from single-query execution to shared multi-query variant orchestration (`intent`, `file-path`, `code-shape`) with deterministic merge and bounded concurrency.
- Added a reusable `executeRetrievalVariants` worker helper and regression coverage for ordered fail-open variant execution.
- Extended mention handling to build and merge retrieval variants and pass merged findings into `buildMentionPrompt` as a dedicated Retrieval section.
- Added regression coverage for review deterministic ordering/variant-failure behavior and mention multi-query invocation + fail-open continuation.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire multi-query retrieval orchestration into review pipeline** - `bf90cacabb` (feat)
2. **Task 2: Extend mention flow to use multi-query retrieval context** - `51a4ad8ad0` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Runs per-variant retrieval, deterministic merge, and fail-open review context assembly.
- `src/handlers/review.test.ts` - Adds RET-07 regressions for variant count bounds, deterministic merged ordering, and partial-failure fail-open behavior.
- `src/learning/multi-query-retrieval.ts` - Adds bounded-concurrency `executeRetrievalVariants` helper.
- `src/learning/multi-query-retrieval.test.ts` - Adds execution helper coverage for ordered fail-open variant results.
- `src/handlers/mention.ts` - Adds mention retrieval variant orchestration and merged retrieval context injection into prompt building.
- `src/handlers/mention.test.ts` - Adds mention RET-07 coverage for multi-query invocation and partial-variant fail-open behavior.
- `src/execution/mention-prompt.ts` - Adds retrieval section rendering for merged findings.
- `src/execution/mention-prompt.test.ts` - Adds prompt rendering assertions for retrieval context.

## Decisions Made
- Reused the same `buildRetrievalVariants`/`mergeVariantResults` contract in both review and mention flows to keep RET-07 behavior surface-consistent.
- Applied bounded variant concurrency (`maxConcurrency=2`) and per-variant `topK` partitioning to avoid serial latency growth.
- Kept downstream review rerank/threshold telemetry pipeline intact after multi-query merge to preserve previous reliability instrumentation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Review and mention retrieval paths now satisfy RET-07 production-path integration requirements.
- Deterministic/fail-open regressions are in place for continuation work on retrieval quality tuning.

## Self-Check

PASSED

---
*Phase: 68-multi-query-retrieval-core*
*Completed: 2026-02-17*

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
