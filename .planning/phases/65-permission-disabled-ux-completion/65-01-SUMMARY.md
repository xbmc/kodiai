---
phase: 65-permission-disabled-ux-completion
plan: 01
subsystem: api
tags: [mentions, issue-comment, write-mode, config-ux, regression-tests]
requires:
  - phase: 64-policy-guardrails-completion
    provides: issue policy refusal coverage and actionable config guidance conventions
provides:
  - Deterministic write-disabled issue refusal copy with explicit `.kodiai.yml` enablement steps
  - Regression coverage for explicit `@kodiai apply:` and `@kodiai change:` issue requests when write mode is off
  - Retry guidance contract that preserves the exact command users should rerun
affects: [issue-write-mode, mention-handler-copy, permission-disabled-ux]
tech-stack:
  added: []
  patterns:
    - Issue write-mode refusals include minimal config snippets and direct retry guidance
    - Explicit issue write-intent tests assert one refusal reply, zero PRs, and no executor run
key-files:
  created: [.planning/phases/65-permission-disabled-ux-completion/65-01-SUMMARY.md]
  modified: [src/handlers/mention.ts, src/handlers/mention.test.ts]
key-decisions:
  - "Disabled write-mode issue replies now include a fixed `.kodiai.yml` snippet and same-command retry instruction."
  - "Write-disabled retry commands are posted unsanitized so `@kodiai apply/change` remains copyable."
patterns-established:
  - "Permission-disabled UX: pair a clear refusal header with minimum config delta and immediate retry instruction."
duration: 2m 14s
completed: 2026-02-16
---

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
