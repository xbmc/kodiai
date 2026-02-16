---
phase: 61-read-only-intent-gating
plan: 01
subsystem: api
tags: [issue-workflow, intent-gating, prompt-contract, testing]

requires:
  - phase: 60-issue-q-a
    provides: issue-surface Q&A contract baseline in mention prompt and tests
provides:
  - Issue-only read-only default contract for non-prefixed implementation requests
  - Exact write opt-in command guidance using @kodiai apply:/change: forms
  - Regression tests preventing instruction leakage to non-issue surfaces
affects: [62-issue-write-mode-pr-creation, 65-permission-disabled-ux]

tech-stack:
  added: []
  patterns:
    - Prompt contract text assertions for behavior-safe intent gating
    - Surface-scoped policy language to avoid cross-surface regressions

key-files:
  created: [.planning/phases/61-read-only-intent-gating/61-01-SUMMARY.md]
  modified: [src/execution/mention-prompt.ts, src/execution/mention-prompt.test.ts]

key-decisions:
  - "Read-only guidance is explicit and default on issue_comment unless a message starts with apply: or change:."
  - "Change-request replies without write prefixes must include both exact opt-in commands: @kodiai apply: <same request> and @kodiai change: <same request>."

patterns-established:
  - "Issue intent gating is encoded in prompt contract first, then enforced at runtime in follow-up plans."

duration: 0 min
completed: 2026-02-16
---

# Phase 61 Plan 01: Read-Only Prompt Contract Summary

**Issue-thread mention guidance now defaults to explicit read-only framing and requires exact apply/change opt-in command examples whenever implementation is requested without write prefixes.**

## Performance

- **Duration:** 0 min
- **Started:** 2026-02-16T06:31:52Z
- **Completed:** 2026-02-16T06:32:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added issue-surface read-only default language to `buildMentionPrompt()` clarifying no implied edits/branch pushes/PR creation without `apply:` or `change:`.
- Added explicit dual-command opt-in contract requiring `@kodiai apply: <same request>` and `@kodiai change: <same request>` in non-prefixed change requests.
- Added regression assertions ensuring these rules appear only for issue surfaces and do not leak into non-issue prompts.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add explicit issue read-only framing and opt-in command contract** - `4d5399e39b` (feat)
2. **Task 2: Add prompt regression tests for read-only and exact opt-in command wording** - `1569abc89e` (test)

## Files Created/Modified
- `.planning/phases/61-read-only-intent-gating/61-01-SUMMARY.md` - Plan execution summary with decisions and verification status
- `src/execution/mention-prompt.ts` - Issue-surface prompt contract now includes read-only default and exact write opt-in command wording
- `src/execution/mention-prompt.test.ts` - Regression tests for issue-only read-only framing and exact command examples

## Decisions Made
- Kept intent gating scoped to `mention.surface === "issue_comment"` so existing PR/review mention behavior remains unchanged.
- Required exact, copyable write opt-in commands for non-prefixed implementation requests to make safe escalation explicit.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 61 plan 01 prompt contract and tests are complete; ready for `61-02-PLAN.md` runtime intent gating.

---
*Phase: 61-read-only-intent-gating*
*Completed: 2026-02-16*

## Self-Check: PASSED

- FOUND: `.planning/phases/61-read-only-intent-gating/61-01-SUMMARY.md`
- FOUND: `4d5399e39b`
- FOUND: `1569abc89e`
