---
id: S02
parent: M013
milestone: M013
provides:
  - Exact rendered-length retrieval budgeting for review and mention prompt builders
  - Markdown-safe path-only fallback formatting when snippet anchors are unavailable
  - Degraded-path regression coverage across review/mention prompt and handler surfaces
  - Deterministic runtime injection of degraded-analysis disclosure into published review summaries
  - Canonical exact-sentence constant shared by prompt and publish enforcement paths
  - Regression tests for exact disclosure presence on degraded summaries and absence on non-degraded summaries
requires: []
affects: []
key_files: []
key_decisions:
  - "Enforce retrieval maxChars against fully rendered section text (header + bullets) so budgets cannot overflow by accounting drift."
  - "Normalize backticks in path-only fallback evidence to apostrophes to avoid malformed markdown when snippet anchors are missing."
  - "Use a post-execution summary safeguard in review handler so degraded disclosure is guaranteed even if model wording drifts."
  - "Anchor prompt and runtime checks to one exported disclosure constant to prevent cross-layer wording divergence."
patterns_established:
  - "Budget contract: drop lowest-priority retrieval bullets until the complete rendered section fits maxChars, otherwise omit section entirely."
  - "Degraded regression contract: verify degraded disclosure behavior and retrieval section formatting in both prompt builders and handler wiring tests."
  - "Degraded-path user-visible contracts are enforced in publish flow, not prompt-only guidance."
  - "Disclosure assertions validate exact sentence count in summary output for degraded vs non-degraded paths."
observability_surfaces: []
drill_down_paths: []
duration: 3 min
verification_result: passed
completed_at: 2026-02-17
blocker_discovered: false
---
# S02: Degraded Retrieval Contract

**# Phase 73 Plan 02: Degraded retrieval rendering contract Summary**

## What Happened

# Phase 73 Plan 02: Degraded retrieval rendering contract Summary

**Degraded review and mention prompt surfaces now enforce exact rendered retrieval budgets with markdown-safe path-only fallback and regression coverage across prompt and handler layers.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-17T08:04:03Z
- **Completed:** 2026-02-17T08:09:12Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Hardened retrieval section rendering in `buildRetrievalContextSection` and mention retrieval blocks to enforce maxChars against full rendered section length, including headers and bullets.
- Preserved degraded evidence quality with deterministic path-only fallback that sanitizes backticks and avoids malformed markdown artifacts.
- Added RET-07 regressions proving bounded retrieval behavior, clean omission when budget drops all findings, and degraded-path integration assertions in review and mention handler tests.

## Task Commits

Each task was committed atomically:

1. **Task 1: Harden retrieval section rendering contract for bounded and well-formed output** - `53d76088d5` (feat)
2. **Task 2: Add degraded-path regressions for retrieval rendering and budget safety** - `b523a104d8` (test)

**Plan metadata:** pending

## Files Created/Modified

- `src/execution/review-prompt.ts` - Switched retrieval budget enforcement to rendered-section length checks and sanitized path-only fallback finding text.
- `src/execution/mention-prompt.ts` - Applied rendered-section budget checks and markdown-safe fallback text sanitization for mention retrieval bullets.
- `src/execution/review-prompt.test.ts` - Added degraded retrieval budget and clean-omission regressions for review prompt rendering.
- `src/execution/mention-prompt.test.ts` - Added markdown-safety and strict retrieval budget regressions for mention prompt rendering.
- `src/handlers/review.test.ts` - Added degraded-path wiring regression for bounded retrieval context delivery into review prompt construction.
- `src/handlers/mention.test.ts` - Added handler-level regression asserting sanitized path-only retrieval fallback text on mention surface.

## Decisions Made

- Enforced retrieval budgets by measuring fully rendered section text rather than incremental counters to guarantee deterministic upper bounds.
- Kept fallback evidence deterministic and markdown-safe by normalizing backticks in non-snippet finding text.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- RET-07 is regression-locked across review and mention degraded retrieval paths.
- Phase 73 is ready for transition into Phase 74 reliability regression gating.

---
*Phase: 73-degraded-retrieval-contract*
*Completed: 2026-02-17*

## Self-Check: PASSED

- FOUND: `.planning/phases/73-degraded-retrieval-contract/73-02-SUMMARY.md`
- FOUND: `53d76088d5`
- FOUND: `b523a104d8`

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
