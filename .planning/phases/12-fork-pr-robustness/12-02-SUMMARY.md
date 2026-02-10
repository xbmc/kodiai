---
phase: 12-fork-pr-robustness
plan: 02
subsystem: mention
tags: [github, git, pull-request, workspace, bun]

# Dependency graph
requires:
  - phase: 12-fork-pr-robustness
    provides: "Fork PR checkout strategy: base clone + fetch pull/<n>/head"
provides:
  - "PR mention workspaces clone base repo and checkout pull/<n>/head (fork-safe)"
  - "Mention context safety invariants remain test-covered (TOCTOU, sanitization, bounds)"
affects: [mention-handler, workspace-manager, fork-pr-support]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mention PR workspace strategy mirrors reviews: base clone at base ref + fetch pull/<n>/head"

key-files:
  created:
    - src/handlers/mention.test.ts
  modified:
    - src/handlers/mention.ts
    - src/execution/mention-context.test.ts

key-decisions:
  - "Use base-clone + pull/<n>/head checkout for all PR mention workspaces (simpler and fork-safe)"

patterns-established:
  - "Use local branch 'pr-mention' for PR head checkout in mention workspaces"

# Metrics
duration: 5 min
completed: 2026-02-10
---

# Phase 12 Plan 02: Mention Fork PR Robustness Summary

**PR mention workspaces now clone the base repo at the base ref and fetch+checkout `pull/<n>/head`, avoiding fork-clone access assumptions while preserving diff/code context.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-10T03:08:04Z
- **Completed:** 2026-02-10T03:13:43Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Updated mention handler PR workspace strategy to be fork-safe via `pull/<n>/head` checkout
- Added regression test asserting PR mention workspaces use base clone + pull ref fetch
- Extended mention-context tests to cover PR title/body sanitization and deterministic truncation

## Task Commits

Each task was committed atomically:

1. **Task 1: Use base-clone + PR-ref fetch strategy for PR mention contexts** - `8b8ee447f2` (feat)
2. **Task 2: Confirm mention context builder still obeys TOCTOU and sanitization** - `0a8918cf1f` (test)

**Plan metadata:** (docs commit updates SUMMARY + STATE)

## Files Created/Modified

- `src/handlers/mention.ts` - Clone base ref for PR mentions, then fetch+checkout `pull/<n>/head` into `pr-mention`
- `src/handlers/mention.test.ts` - Workspace strategy regression coverage using local `refs/pull/<n>/head` fixture
- `src/execution/mention-context.test.ts` - Added assertions for PR title/body sanitization + bounded truncation

## Decisions Made

- Use the PR ref strategy for all PR mentions (not fork-only) to keep logic simple and robust under GitHub App token constraints.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `12-03-PLAN.md`.

---

## Self-Check: PASSED

- FOUND: `.planning/phases/12-fork-pr-robustness/12-02-SUMMARY.md`
- FOUND: `8b8ee447f2` (Task 1)
- FOUND: `0a8918cf1f` (Task 2)
