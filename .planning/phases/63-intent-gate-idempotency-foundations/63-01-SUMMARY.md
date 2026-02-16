---
phase: 63-intent-gate-idempotency-foundations
plan: 01
subsystem: api
tags: [issue-workflow, intent-gating, write-mode, idempotency, testing]
requires:
  - phase: 62-issue-write-mode-pr-creation
    provides: issue-surface apply/change write-mode PR flow
provides:
  - Non-prefixed issue implementation asks now reply with explicit opt-in guidance commands instead of entering write mode
  - Explicit apply/change prefixed issue comments continue to enter write mode normally
  - Regression coverage proving guidance and explicit prefix behavior
affects: [phase-63-plan-02, issue-write-mode, mention-handler]
tech-stack:
  added: []
  patterns:
    - Detect implicit issue intent without auto-promoting to write mode
    - Preserve exact opt-in command text in issue guidance replies
key-files:
  created:
    - .planning/phases/63-intent-gate-idempotency-foundations/63-01-SUMMARY.md
  modified:
    - src/handlers/mention.ts
    - src/handlers/mention.test.ts
key-decisions:
  - "Implicit issue intent detection remains enabled, but only gates to read-only opt-in guidance"
  - "Issue opt-in guidance replies bypass mention sanitization so exact @kodiai apply/change commands remain copyable"
patterns-established:
  - "Issue implicit-intent gate runs before write-mode branch/PR computation"
  - "Explicit apply/change prefixes are the sole path to writeMode=true for issue comments"
duration: 1 min
completed: 2026-02-16
---

# Phase 63 Plan 01: Restore explicit opt-in safety Summary

**Issue-comment implicit implementation intents now produce explicit `@kodiai apply/change` guidance replies while preserving explicit prefix write-mode behavior.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-16T20:25:15Z
- **Completed:** 2026-02-16T20:26:33Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added RED-phase regression tests for non-prefixed issue implementation asks and explicit apply control behavior.
- Updated mention handling so implicit issue intents no longer auto-promote to write mode.
- Added an early guidance-reply gate that posts exact `@kodiai apply:` and `@kodiai change:` commands for opt-in.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED - Add failing tests for implicit intent opt-in guidance** - `38e7521276` (test)
2. **Task 2: GREEN - Gate implicit intent to opt-in guidance reply** - `e0dda71df4` (feat)

**Plan metadata:** pending

## Files Created/Modified
- `src/handlers/mention.test.ts` - Added regression tests for implicit intent guidance and explicit apply write-mode behavior, and aligned legacy expectations with explicit opt-in safety.
- `src/handlers/mention.ts` - Removed implicit write auto-promotion and added guidance-only gate with exact opt-in commands.

## Decisions Made
- Kept `detectImplicitIssueIntent` active as a safety detector, but removed its write-mode auto-promotion role.
- Preserved exact `@kodiai` command strings in guidance replies by skipping mention sanitization for this specific response path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved exact opt-in command handles in guidance replies**
- **Found during:** Task 2 (GREEN - Gate implicit intent to opt-in guidance reply)
- **Issue:** Guidance posted through normal sanitized replies stripped `@kodiai`, violating explicit-command requirements.
- **Fix:** Added optional reply sanitization control and disabled mention sanitization only for this explicit opt-in guidance path.
- **Files modified:** src/handlers/mention.ts, src/handlers/mention.test.ts
- **Verification:** `bun test src/handlers/mention.test.ts --timeout 30000`
- **Committed in:** `e0dda71df4` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix was necessary to satisfy explicit opt-in command correctness; no scope creep.

## Issues Encountered
- None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 63 plan 01 safety contract is restored and regression-protected.
- Ready for 63-02 idempotency/in-flight de-dupe and rate-limit hardening work.

---
*Phase: 63-intent-gate-idempotency-foundations*
*Completed: 2026-02-16*

## Self-Check: PASSED

- FOUND: .planning/phases/63-intent-gate-idempotency-foundations/63-01-SUMMARY.md
- FOUND: 38e7521276
- FOUND: e0dda71df4
