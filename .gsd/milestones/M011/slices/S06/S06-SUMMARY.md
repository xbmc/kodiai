---
id: S06
parent: M011
milestone: M011
provides:
  - Permission-aware write-mode refusal handling for PR-create and push failures
  - Deterministic issue-thread remediation message with minimum GitHub App scopes
  - Regression coverage for issue write-mode permission failure UX
  - Deterministic write-disabled issue refusal copy with explicit `.kodiai.yml` enablement steps
  - Regression coverage for explicit `@kodiai apply:` and `@kodiai change:` issue requests when write mode is off
  - Retry guidance contract that preserves the exact command users should rerun
requires: []
affects: []
key_files: []
key_decisions:
  - "Permission-classified write failures now bypass generic error comments and emit deterministic remediation guidance."
  - "Permission remediation includes minimum Contents/Pull requests/Issues write scopes plus same-command retry instructions."
  - "Disabled write-mode issue replies now include a fixed `.kodiai.yml` snippet and same-command retry instruction."
  - "Write-disabled retry commands are posted unsanitized so `@kodiai apply/change` remains copyable."
patterns_established:
  - "Permission UX pattern: classify 401/403 and known push/forbidden signals, then post actionable in-thread guidance without raw error payloads."
  - "Permission-disabled UX: pair a clear refusal header with minimum config delta and immediate retry instruction."
observability_surfaces: []
drill_down_paths: []
duration: 2m 14s
verification_result: passed
completed_at: 2026-02-16
blocker_discovered: false
---
# S06: Permission Disabled Ux Completion

**# Phase 65 Plan 02: Permission Disabled UX Completion Summary**

## What Happened

# Phase 65 Plan 02: Permission Disabled UX Completion Summary

**Issue write-mode now classifies GitHub App permission denials and replies with minimum-scope remediation plus safe retry guidance instead of generic API error output.**

## Performance

- **Duration:** 3m18s
- **Started:** 2026-02-16T21:32:48Z
- **Completed:** 2026-02-16T21:36:06Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added two issue-surface regressions for permission-denied PR creation and push-before-PR failures.
- Implemented permission-failure classification in write-mode handling for push/update and PR-create paths.
- Added deterministic, non-sensitive remediation replies listing required GitHub App scopes and retry command guidance.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add failing regression tests for issue write-mode permission failures** - `c3e5527764` (test)
2. **Task 2: Implement permission-aware refusal handling for write-mode failures** - `dfc7ebd780` (feat)

**Plan metadata:** (pending final docs commit)

## Files Created/Modified
- `src/handlers/mention.test.ts` - Regression tests for PR-create and push-permission failure remediation contract.
- `src/handlers/mention.ts` - Permission-failure classifier and dedicated remediation reply path for write-mode failures.

## Decisions Made
- Permission-like write failures are intercepted before generic error classification to ensure actionable in-thread guidance.
- Remediation copy standardizes minimum required permissions (`Contents`, `Pull requests`, `Issues` as Read and write) and same-command retry instructions.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Initial implementation wording did not exactly match new regression contract text; adjusted remediation phrasing and re-ran tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Mention handler now has stable permission-failure UX coverage for issue write-mode.
- Ready for downstream phase verification that validates end-to-end permission remediation behavior.

## Self-Check: PASSED
- FOUND: `.planning/phases/65-permission-disabled-ux-completion/65-02-SUMMARY.md`
- FOUND: `c3e5527764`
- FOUND: `dfc7ebd780`

## Auth Gates

None.

---
*Phase: 65-permission-disabled-ux-completion*
*Completed: 2026-02-16*

# Phase 65 Plan 01: Permission Disabled UX Completion Summary

**Issue write-disabled responses now include exact `.kodiai.yml` enablement instructions plus copyable `@kodiai apply/change` retry commands, with regression tests covering both explicit write prefixes.**

## Performance

- **Duration:** 2m 14s
- **Started:** 2026-02-16T21:29:21Z
- **Completed:** 2026-02-16T21:31:35Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added regression coverage for explicit issue `@kodiai apply:` and `@kodiai change:` requests when write mode is disabled.
- Locked the refusal contract to require `Write mode is disabled for this repo`, explicit `Update ".kodiai.yml"` guidance, minimal YAML snippet, and retry cue.
- Updated mention-handler refusal copy to include deterministic `.kodiai.yml` instructions and a same-command rerun message.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add regression tests for disabled-write issue guidance** - `3bb2062ae4` (test)
2. **Task 2: Update disabled-write refusal message to match actionable contract** - `575769ec62` (feat)

**Plan metadata:** pending

## Files Created/Modified
- `src/handlers/mention.test.ts` - Adds explicit apply/change disabled-write issue tests asserting single refusal reply, snippet guidance, and retry instructions.
- `src/handlers/mention.ts` - Revises disabled-write refusal copy to include explicit `.kodiai.yml` update instructions and same-command retry text.

## Decisions Made
- Chose explicit `Update ".kodiai.yml":` language before the YAML block to remove ambiguity about where write mode should be enabled.
- Included the exact `@kodiai {apply|change}: ...` command in retry guidance so users can rerun without rephrasing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved `@kodiai` in retry command output**
- **Found during:** Task 2 (Update disabled-write refusal message to match actionable contract)
- **Issue:** Mention sanitization stripped `@` from retry commands, producing `kodiai apply:` text that no longer matched the exact rerun command contract.
- **Fix:** Posted the write-disabled refusal reply with mention sanitization disabled for this branch so `@kodiai` remains copyable.
- **Files modified:** src/handlers/mention.ts
- **Verification:** `bun test src/handlers/mention.test.ts --timeout 30000` and `bunx tsc --noEmit`
- **Committed in:** `575769ec62` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix was required to satisfy the exact retry-command UX contract; no scope creep.

## Issues Encountered
- None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Disabled-write issue guidance is now deterministic and regression-locked for explicit apply/change paths.
- Ready to execute the next phase 65 plan.

---
*Phase: 65-permission-disabled-ux-completion*
*Completed: 2026-02-16*

## Self-Check: PASSED
- FOUND: `.planning/phases/65-permission-disabled-ux-completion/65-01-SUMMARY.md`
- FOUND: `3bb2062ae4`
- FOUND: `575769ec62`
