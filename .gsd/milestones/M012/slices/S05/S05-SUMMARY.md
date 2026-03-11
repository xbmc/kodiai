---
id: S05
parent: M012
milestone: M012
provides:
  - Cross-surface prompt-contract regression matrix for issue, PR comment, and review-thread mention prompts
  - Runtime regression coverage for one-question fallback behavior and surface safety gates
  - Deterministic assertions preventing implicit write-mode leakage from issue-only intent gating
  - One shared conversational contract section across issue, PR, and review-thread mention prompts
  - Deterministic one-question clarifying fallback for non-published successful mention runs
  - Regression coverage for contract consistency and safety invariants across mention surfaces
requires: []
affects: []
key_files: []
key_decisions:
  - "Prompt contract checks assert durable markers and sequence order instead of brittle full-paragraph snapshots."
  - "PR top-level mention fixtures now include issue.number plus pull_request shape to validate PR-surface behavior without issue-only intent leakage."
  - "Moved direct-answer/evidence/next-step instructions into a shared Conversational Response Contract section for all mention surfaces."
  - "Standardized runtime non-published fallback to one targeted clarifying question while keeping existing write-intent and fail-open safety gates unchanged."
patterns_established:
  - "Cross-surface contract tests should validate marker presence + ordering, not exact prose snapshots."
  - "Mention safety tests should explicitly cover issue, PR top-level, and review-thread non-published execution paths."
  - "Cross-surface mention prompts should share response-contract semantics; keep only truly surface-specific rules in scoped sections."
  - "Fallback messaging should ask one minimum-context question and remain single-reply fail-open."
observability_surfaces: []
drill_down_paths: []
duration: 2 min
verification_result: passed
completed_at: 2026-02-17
blocker_discovered: false
---
# S05: Cross Surface Conversational Ux

**# Phase 70 Plan 02: Cross-surface Conversational UX Summary**

## What Happened

# Phase 70 Plan 02: Cross-surface Conversational UX Summary

**Cross-surface regression suites now lock conversational contract wording, one-question fallback behavior, and safety gates across issue, PR, and review-thread mention flows.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-17T02:24:19Z
- **Completed:** 2026-02-17T02:26:50Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added a table-driven prompt regression matrix that verifies shared contract markers and order (direct answer -> evidence pointers -> next-step framing) for issue, PR comment, and review-thread surfaces.
- Locked insufficient-context guidance to one targeted clarifying question and prohibited generic clarification wording across all mention surfaces.
- Expanded handler runtime regressions to cover PR top-level fallback, non-mention short-circuit safety, and prevention of implicit write-mode auto-promotion on PR/review surfaces.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add cross-surface prompt-contract regression matrix** - `da07085bb7` (test)
2. **Task 2: Add handler safety + clarification regressions across mention surfaces** - `dfa64e29b2` (test)

**Plan metadata:** pending

## Files Created/Modified
- `src/execution/mention-prompt.test.ts` - Adds table-driven cross-surface contract markers, ordering assertions, and one-question fallback wording checks.
- `src/handlers/mention.test.ts` - Adds runtime regressions for PR top-level fallback, non-mention no-reply short-circuiting, and PR/review write-mode safety gating.
- `.planning/phases/70-cross-surface-conversational-ux/70-02-SUMMARY.md` - Records execution outcomes, decisions, and verification metadata.

## Decisions Made
- Prefer durable marker and sequence assertions for contract tests so harmless copy edits do not cause false regressions.
- Use explicit PR-shaped issue_comment fixtures (`issue.number` + `issue.pull_request`) when asserting PR top-level mention behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CONV-01/CONV-02 regression coverage now protects prompt and runtime behavior across all conversational mention surfaces.
- Phase 70 implementation and regression plans are complete; milestone is ready for transition/verification.

---
*Phase: 70-cross-surface-conversational-ux*
*Completed: 2026-02-17*

## Self-Check: PASSED

- FOUND: `.planning/phases/70-cross-surface-conversational-ux/70-02-SUMMARY.md`
- FOUND: `da07085bb7`
- FOUND: `dfa64e29b2`

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
