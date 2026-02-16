---
phase: 61-read-only-intent-gating
plan: 02
subsystem: api
tags: [mentions, issue-comment, intent-gating, safety]

# Dependency graph
requires:
  - phase: 60-03
    provides: Issue-comment prompt/context wiring and fallback behavior
provides:
  - Runtime issue-comment detector that blocks non-prefixed implementation asks before execution
  - Deterministic read-only issue reply with exact apply/change opt-in commands
  - Regression coverage for SAFE-01 and ISSUE-02 issue-surface intent behavior
affects: [phase-62, issue-write-mode, mention-handler]

# Tech tracking
tech-stack:
  added: []
  patterns: [issue intent preflight gating, deterministic command guidance, issue-surface write short-circuit]

key-files:
  created: [.planning/phases/61-read-only-intent-gating/61-02-SUMMARY.md]
  modified: [src/handlers/mention.ts, src/handlers/mention.test.ts]

key-decisions:
  - "Gate issue implementation asks before executor invocation by matching conservative implementation verbs when no apply:/change:/plan: prefix is present."
  - "Post issue opt-in guidance through direct issue comment creation so exact @kodiai apply/change commands are preserved in output."

patterns-established:
  - "Issue runtime intent gate: mention.surface === issue_comment + non-prefixed implementation ask -> deterministic opt-in command reply and early return."
  - "Phase 61 safety behavior: explicit issue apply/change remains non-writing and responds with PR-context-only guidance."

# Metrics
duration: 2 min
completed: 2026-02-16
---

# Phase 61 Plan 02: Runtime Issue Intent Gating Summary

**Issue-thread implementation asks now stop at a runtime read-only gate unless users explicitly prefix with `apply:` or `change:`, with deterministic opt-in commands returned in-thread.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-16T06:31:51Z
- **Completed:** 2026-02-16T06:34:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added issue-surface runtime intent detection that blocks non-prefixed implementation requests before executor/write flow.
- Returned exact opt-in commands (`@kodiai apply:` / `@kodiai change:`) for non-prefixed change asks in issue comments.
- Added regression tests for non-prefixed change gating, non-change issue Q&A passthrough, and explicit issue `apply:` non-writing safety.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add issue-surface runtime intent gate and deterministic opt-in reply** - `5566bc33ed` (feat)
2. **Task 2: Add handler tests for SAFE-01 and prefix command guidance** - `8e330cabad` (test)

**Plan metadata:** pending

## Files Created/Modified
- `src/handlers/mention.ts` - Adds non-prefixed issue implementation detector and deterministic read-only opt-in command reply path.
- `src/handlers/mention.test.ts` - Adds focused issue intent-gating regression tests and aligns fallback question fixture with non-change Q&A behavior.
- `.planning/phases/61-read-only-intent-gating/61-02-SUMMARY.md` - Execution summary and metadata for this plan.

## Decisions Made
- Applied runtime intent gating only for `mention.surface === "issue_comment"` so PR mention surfaces keep existing behavior.
- Preserved exact `@kodiai` command prefixes in the opt-in guidance response to satisfy deterministic copy/paste UX.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated stale fallback test fixture after runtime gate introduction**
- **Found during:** Task 1 (Add issue-surface runtime intent gate and deterministic opt-in reply)
- **Issue:** Existing fallback test used a non-prefixed implementation ask (`can you fix ...`) that now correctly triggers the new gate before executor fallback behavior.
- **Fix:** Switched that fixture to an informational issue question so it continues validating non-published fallback behavior without conflicting with new intent gating.
- **Files modified:** src/handlers/mention.test.ts
- **Verification:** `bun test src/handlers/mention.test.ts --timeout 30000`
- **Committed in:** `5566bc33ed` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Change was required to keep legacy coverage aligned with the new runtime gate; no scope creep.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- SAFE-01 runtime gate and ISSUE-02 opt-in command UX are now enforced in handler logic for issue comments.
- Ready for remaining Phase 61 plan sequencing and Phase 62 issue write-mode PR flow.

## Self-Check: PASSED

- FOUND: `.planning/phases/61-read-only-intent-gating/61-02-SUMMARY.md`
- FOUND: `5566bc33ed`
- FOUND: `8e330cabad`

---
*Phase: 61-read-only-intent-gating*
*Completed: 2026-02-16*
