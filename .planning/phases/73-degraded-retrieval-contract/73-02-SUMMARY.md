---
phase: 73-degraded-retrieval-contract
plan: 02
subsystem: api
tags: [ret-07, retrieval, prompt-budget, degraded-path, review, mention]
requires:
  - phase: 73-01
    provides: deterministic degraded-analysis disclosure sentence contract
provides:
  - Exact rendered-length retrieval budgeting for review and mention prompt builders
  - Markdown-safe path-only fallback formatting when snippet anchors are unavailable
  - Degraded-path regression coverage across review/mention prompt and handler surfaces
affects: [review-prompt, mention-prompt, review-handler, mention-handler, degraded-retrieval-contract]
tech-stack:
  added: []
  patterns:
    - Render-first budget enforcement (check full section length before keeping findings)
    - Path-only fallback sanitizes inline backticks to preserve retrieval markdown validity
key-files:
  created: []
  modified:
    - src/execution/review-prompt.ts
    - src/execution/mention-prompt.ts
    - src/execution/review-prompt.test.ts
    - src/execution/mention-prompt.test.ts
    - src/handlers/review.test.ts
    - src/handlers/mention.test.ts
key-decisions:
  - "Enforce retrieval maxChars against fully rendered section text (header + bullets) so budgets cannot overflow by accounting drift."
  - "Normalize backticks in path-only fallback evidence to apostrophes to avoid malformed markdown when snippet anchors are missing."
patterns-established:
  - "Budget contract: drop lowest-priority retrieval bullets until the complete rendered section fits maxChars, otherwise omit section entirely."
  - "Degraded regression contract: verify degraded disclosure behavior and retrieval section formatting in both prompt builders and handler wiring tests."
duration: 5 min
completed: 2026-02-17
---

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
