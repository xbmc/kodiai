---
id: T01
parent: S05
milestone: M012
provides:
  - One shared conversational contract section across issue, PR, and review-thread mention prompts
  - Deterministic one-question clarifying fallback for non-published successful mention runs
  - Regression coverage for contract consistency and safety invariants across mention surfaces
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 2 min
verification_result: passed
completed_at: 2026-02-17
blocker_discovered: false
---
# T01: 70-cross-surface-conversational-ux 01

**# Phase 70 Plan 01: Cross-surface Conversational UX Summary**

## What Happened

# Phase 70 Plan 01: Cross-surface Conversational UX Summary

**Unified issue, PR, and review-thread mention behavior under one conversational contract with a deterministic single-question clarifying fallback.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-17T02:17:17Z
- **Completed:** 2026-02-17T02:19:35Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added a shared `## Conversational Response Contract` section requiring direct answer first, evidence pointers, and next-step framing for all mention surfaces.
- Replaced multi-question runtime fallback copy with one targeted clarifying question for issue, PR, and review-thread mention flows.
- Preserved issue-only write/read intent policy language and surface-specific publish mechanics, with regression tests to prevent policy leakage.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement a single conversational contract section for all mention surfaces** - `222e993bcc` (feat)
2. **Task 2: Align runtime fallback messaging and safety guards with the unified contract** - `47296a32aa` (feat)

**Plan metadata:** pending

## Files Created/Modified
- `src/execution/mention-prompt.ts` - Added shared conversational response contract and one-question clarification rule.
- `src/execution/mention-prompt.test.ts` - Added cross-surface contract assertions and issue-only policy scoping checks.
- `src/handlers/mention.ts` - Updated non-published success fallback to one targeted clarifying question.
- `src/handlers/mention.test.ts` - Updated fallback regressions and added review-thread fallback/safety validation.

## Decisions Made
- Used one shared contract section for direct answer, evidence pointers, and next-step framing to enforce CONV-01 consistency across issue/pr_comment/pr_review_comment surfaces.
- Kept issue-only policy language in a dedicated issue section so implicit write-mode behavior remains scoped to issue comments and does not leak to PR/review surfaces.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CONV-01 and CONV-02 prompt/runtime behavior is in place with passing surface-level regressions.
- Ready for `70-02-PLAN.md`.

---
*Phase: 70-cross-surface-conversational-ux*
*Completed: 2026-02-17*

## Self-Check: PASSED
