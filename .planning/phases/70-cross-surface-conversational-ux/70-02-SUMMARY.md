---
phase: 70-cross-surface-conversational-ux
plan: 02
subsystem: testing
tags: [mentions, regression-tests, conversational-ux, safety, prompt-contract]

# Dependency graph
requires:
  - phase: 70-cross-surface-conversational-ux
    provides: unified conversational response contract and one-question fallback behavior
  - phase: 60-issue-q-a
    provides: issue mention fallback and no-unsolicited-response baseline
provides:
  - Cross-surface prompt-contract regression matrix for issue, PR comment, and review-thread mention prompts
  - Runtime regression coverage for one-question fallback behavior and surface safety gates
  - Deterministic assertions preventing implicit write-mode leakage from issue-only intent gating
affects: [mention-prompt, mention-handler, conversational-reliability, safety-guardrails]

# Tech tracking
tech-stack:
  added: []
  patterns: [table-driven prompt contract tests, cross-surface fallback assertions, safety-gate regression locking]

key-files:
  created: [.planning/phases/70-cross-surface-conversational-ux/70-02-SUMMARY.md]
  modified: [src/execution/mention-prompt.test.ts, src/handlers/mention.test.ts]

key-decisions:
  - "Prompt contract checks assert durable markers and sequence order instead of brittle full-paragraph snapshots."
  - "PR top-level mention fixtures now include issue.number plus pull_request shape to validate PR-surface behavior without issue-only intent leakage."

patterns-established:
  - "Cross-surface contract tests should validate marker presence + ordering, not exact prose snapshots."
  - "Mention safety tests should explicitly cover issue, PR top-level, and review-thread non-published execution paths."

# Metrics
duration: 2 min
completed: 2026-02-17
---

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
