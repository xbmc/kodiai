---
phase: 73-degraded-retrieval-contract
plan: 01
subsystem: api
tags: [review-handler, degraded, rate-limit, regression, prompt-contract]
requires:
  - phase: 72-telemetry-follow-through
    provides: exactly-once degraded telemetry identity and verified Search rate-limit degradation paths
provides:
  - Deterministic runtime injection of degraded-analysis disclosure into published review summaries
  - Canonical exact-sentence constant shared by prompt and publish enforcement paths
  - Regression tests for exact disclosure presence on degraded summaries and absence on non-degraded summaries
affects: [ret-06, degraded-review-output, review-summary-contract]
tech-stack:
  added: []
  patterns:
    - Runtime publish-time contract enforcement for model-output drift resistance
    - Shared prompt/runtime constants for exact policy sentence reuse
key-files:
  created: []
  modified:
    - src/handlers/review.ts
    - src/handlers/review.test.ts
    - src/execution/review-prompt.ts
    - src/execution/review-prompt.test.ts
key-decisions:
  - "Use a post-execution summary safeguard in review handler so degraded disclosure is guaranteed even if model wording drifts."
  - "Anchor prompt and runtime checks to one exported disclosure constant to prevent cross-layer wording divergence."
patterns-established:
  - "Degraded-path user-visible contracts are enforced in publish flow, not prompt-only guidance."
  - "Disclosure assertions validate exact sentence count in summary output for degraded vs non-degraded paths."
duration: 3 min
completed: 2026-02-17
---

# Phase 73 Plan 01: Deterministic degraded disclosure summary

**Published review summaries now deterministically include the exact degraded-analysis sentence when Search enrichment rate-limits, with prompt/runtime contract alignment and regression guards.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-17T07:43:53Z
- **Completed:** 2026-02-17T07:47:01Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added runtime enforcement in review publish flow that injects `Analysis is partial due to API limits.` into degraded summary output exactly when needed.
- Reused one canonical disclosure constant across prompt instructions and publish-time summary enforcement.
- Added regression tests proving degraded summaries include exactly one disclosure sentence and non-degraded summaries do not include it.
- Tightened prompt tests so exact-sentence drift fails fast.

## Task Commits

Each task was committed atomically:

1. **Task 1: Enforce exact degraded disclosure sentence in published review output** - `7b8869f015` (feat)
2. **Task 2: Align prompt degradation contract and add exact-text regressions** - `3530a350d3` (test)

**Plan metadata:** pending

## Files Created/Modified

- `src/handlers/review.ts` - Adds publish-time degraded disclosure safeguard using canonical sentence and summary-body injection.
- `src/execution/review-prompt.ts` - Exports canonical disclosure sentence constant and reuses it in degradation prompt section.
- `src/handlers/review.test.ts` - Adds handler-level tests for exactly-once degraded summary disclosure and non-degraded absence.
- `src/execution/review-prompt.test.ts` - Adds strict prompt assertions for exact disclosure sentence usage/count.

## Decisions Made

- Enforced RET-06 at publish time by inspecting `authorClassification.searchEnrichment.degraded` rather than relying on model-generated prose.
- Injected disclosure before summary closing `</details>` so marker tags and existing details structure remain intact.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- RET-06 exact-sentence disclosure is now enforced and regression-protected at both prompt and publish layers.
- Ready for `73-02` bounded retrieval evidence rendering contract work.

## Self-Check: PASSED

- Found `.planning/phases/73-degraded-retrieval-contract/73-01-SUMMARY.md`.
- Verified commits `7b8869f015` and `3530a350d3` exist in git history.

---
*Phase: 73-degraded-retrieval-contract*
*Completed: 2026-02-17*
