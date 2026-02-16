---
phase: 60-issue-q-a
plan: 01
subsystem: api
tags: [issue-workflow, mention, prompt-contract, testing]

requires:
  - phase: 59-resilience-layer
    provides: timeout-resilient mention/review execution baseline used by issue workflows
provides:
  - Issue-surface Q&A response contract embedded directly in mention prompt instructions
  - Regression tests that lock direct-answer, path-evidence, and targeted-clarification guarantees
affects: [61-read-only-intent-gating, 62-issue-write-mode-pr-creation]

tech-stack:
  added: []
  patterns:
    - Surface-gated prompt policy blocks for behavior that should only apply on one mention surface
    - Prompt text assertions as regression tests for non-negotiable response quality rules

key-files:
  created: [.planning/phases/60-issue-q-a/60-01-SUMMARY.md]
  modified: [src/execution/mention-prompt.ts, src/execution/mention-prompt.test.ts]

key-decisions:
  - "Issue Q&A guarantees are gated to mention.surface === issue_comment to avoid changing PR-specific response behavior."
  - "Path evidence guidance standardizes concrete path formatting (path or path:line) and requires claim-to-path linkage."

patterns-established:
  - "Issue prompt contract first, handler wiring later: quality guarantees are encoded and tested before integration plans."

duration: 1 min
completed: 2026-02-16
---

# Phase 60 Plan 01: Issue Q&A Contract Summary

**Issue mentions now require a direct first-sentence answer, evidence-backed repository path pointers, and targeted clarification questions when code context is missing.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-16T06:03:12Z
- **Completed:** 2026-02-16T06:04:36Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added an explicit `Issue Q&A Requirements` block in `buildMentionPrompt()` for `issue_comment` surface only.
- Encoded mandatory direct-answer-first behavior, concrete file-path evidence requirements, and anti-fabrication fallback guidance.
- Added regression tests that fail if issue-only prompt guarantees are removed or leaked onto non-issue surfaces.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add issue-specific answer quality contract to mention prompt** - `9ab8c24e25` (feat)
2. **Task 2: Add regression tests for issue Q&A prompt guarantees** - `46e3c34f4f` (test)

## Files Created/Modified
- `.planning/phases/60-issue-q-a/60-01-SUMMARY.md` - Execution summary with decisions, metrics, and validation notes
- `src/execution/mention-prompt.ts` - Added issue-surface response contract block for Q&A quality constraints
- `src/execution/mention-prompt.test.ts` - Added issue-surface contract assertions and non-issue gating regression test

## Decisions Made
- Gated issue Q&A requirements to `mention.surface === "issue_comment"` so PR/review mention behavior remains unchanged.
- Kept path guidance concrete (`src/file.ts` / `src/file.ts:42`) and paired with explicit anti-fabrication fallback.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 60 plan 01 output is complete and verified; ready for `60-02-PLAN.md`.

---
*Phase: 60-issue-q-a*
*Completed: 2026-02-16*

## Self-Check: PASSED

- FOUND: `.planning/phases/60-issue-q-a/60-01-SUMMARY.md`
- FOUND: `9ab8c24e25`
- FOUND: `46e3c34f4f`
