---
id: S04
parent: M011
milestone: M011
provides:
  - Non-prefixed issue implementation asks now reply with explicit opt-in guidance commands instead of entering write mode
  - Explicit apply/change prefixed issue comments continue to enter write mode normally
  - Regression coverage proving guidance and explicit prefix behavior
  - Issue-surface regression coverage for existing-PR idempotency reuse
  - Issue-surface in-flight duplicate suppression coverage
  - Issue-surface write-rate limit retry guidance coverage
requires: []
affects: []
key_files: []
key_decisions:
  - "Implicit issue intent detection remains enabled, but only gates to read-only opt-in guidance"
  - "Issue opt-in guidance replies bypass mention sanitization so exact @kodiai apply/change commands remain copyable"
  - "Assert concurrent in-flight de-dupe via contains/occurrence checks instead of reply-index ordering to avoid race-dependent flakes."
  - "Model issue rate limiting with different comment IDs in the same repo to validate repo-scoped minInterval enforcement."
patterns_established:
  - "Issue implicit-intent gate runs before write-mode branch/PR computation"
  - "Explicit apply/change prefixes are the sole path to writeMode=true for issue comments"
  - "Issue write-mode regressions should validate executor call counts and PR creation counts together."
  - "Issue idempotency tests should mock pulls.list deterministic-branch lookup and assert Existing PR reply content."
observability_surfaces: []
drill_down_paths: []
duration: 3 min
verification_result: passed
completed_at: 2026-02-16
blocker_discovered: false
---
# S04: Intent Gate Idempotency Foundations

**# Phase 63 Plan 01: Restore explicit opt-in safety Summary**

## What Happened

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

### Post-Execution Policy Override

- **Change source:** User direction after 63-01 execution.
- **Policy update:** Relax explicit prefix requirement for issue implementation asks; conversational non-prefixed asks can auto-promote to write mode.
- **Rationale:** Write operations are PR-only and non-destructive, so explicit opt-in is no longer required for issue implementation intent.
- **Follow-up:** Handler and tests were updated after 63-01 to reflect this override while keeping idempotency, de-dupe, and rate-limit safeguards intact.

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

# Phase 63 Plan 02: Intent Gate Idempotency Foundations Summary

**Issue-surface write safeguards are now locked by regression tests for deterministic existing-PR reuse, in-flight duplicate suppression, and repo-scoped retry-later rate limiting.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-16T20:41:24Z
- **Completed:** 2026-02-16T20:44:39Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added an issue-comment replay test proving deterministic branch idempotency reuses an existing PR and skips executor/PR creation work.
- Added concurrent issue apply coverage proving one request executes while duplicates get a clear already-in-progress response.
- Added issue-surface rate-limit coverage proving second rapid request gets retry guidance and no extra PR is opened.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add issue-surface idempotency regression test** - `6b38b2c9e1` (test)
2. **Task 2: Add issue-surface in-flight de-dupe and rate limit regression tests** - `913b5dac5f` (test)

**Plan metadata:** `(pending)`

## Files Created/Modified
- `src/handlers/mention.test.ts` - Adds three focused issue write-mode regression tests for idempotency, de-dupe, and rate limiting.
- `.planning/phases/63-intent-gate-idempotency-foundations/63-02-SUMMARY.md` - Captures execution outcomes, decisions, and verification evidence for plan 63-02.

## Decisions Made
- Kept in-flight concurrency assertions order-insensitive because reply ordering is race-dependent while behavior guarantees are call-count and message-presence based.
- Used distinct issue comment IDs for rate-limit validation so de-duplication and idempotency keys do not mask repo-level limiter behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed race-sensitive assertion in concurrent in-flight test**
- **Found during:** Task 2 (issue-surface in-flight de-dupe and rate limiting)
- **Issue:** Initial assertion expected the second captured reply index to always contain the in-flight message, which flaked under valid concurrent ordering.
- **Fix:** Updated assertion to check message presence and single Opened PR occurrence instead of fixed reply index.
- **Files modified:** src/handlers/mention.test.ts
- **Verification:** `bun test src/handlers/mention.test.ts --timeout 30000`, `bun test`, `bunx tsc --noEmit`
- **Committed in:** `913b5dac5f` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Deviation tightened test determinism for intended concurrent behavior without changing scope.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 63 plan 02 regression coverage is complete and verifications pass.
- Phase 63 now has all plan summaries and is ready for phase transition workflow.

## Self-Check: PASSED
- FOUND: `.planning/phases/63-intent-gate-idempotency-foundations/63-02-SUMMARY.md`
- FOUND: `6b38b2c9e1`
- FOUND: `913b5dac5f`

---
*Phase: 63-intent-gate-idempotency-foundations*
*Completed: 2026-02-16*
