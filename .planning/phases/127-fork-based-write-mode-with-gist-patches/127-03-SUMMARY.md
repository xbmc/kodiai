---
phase: 127-fork-based-write-mode-with-gist-patches
plan: 03
subsystem: execution
tags: [prompts, fork, cleanup, branches, github-api]

# Dependency graph
requires:
  - phase: 127-01
    provides: "Fork manager and bot user auth foundation"
provides:
  - "Fork-only write policy instructions for agent system prompt"
  - "Legacy branch cleanup script for kodiai/* branches"
affects: [write-mode, mention-handler, agent-prompts]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Centralized prompt fragments in src/execution/prompts.ts", "Dual enforcement: code guard + prompt instructions"]

key-files:
  created:
    - src/execution/prompts.ts
    - scripts/cleanup-legacy-branches.ts
  modified:
    - src/handlers/mention.ts

key-decisions:
  - "Fork policy instructions added to write-mode prompt only, not read-only assistant prompt"
  - "Prompt fragment centralized in src/execution/prompts.ts for reuse across handlers"

patterns-established:
  - "Shared prompt fragments: exportable constants in src/execution/prompts.ts"

requirements-completed: [FORK-09, FORK-10]

# Metrics
duration: 2min
completed: 2026-03-07
---

# Phase 127 Plan 03: Agent Prompt Fork Instructions and Legacy Branch Cleanup Summary

**Fork-only write policy in agent system prompt plus one-time cleanup script for legacy kodiai/* branches**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-07T21:53:46Z
- **Completed:** 2026-03-07T21:55:59Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Agent write-mode prompt now explicitly instructs the AI that origin points to a fork, not the target repo
- Created reusable FORK_WRITE_POLICY_INSTRUCTIONS constant in src/execution/prompts.ts
- Legacy branch cleanup script supports dry-run mode, --owner/--repo flags, and GitHub App auth

## Task Commits

Each task was committed atomically:

1. **Task 1: Add fork-only instructions to agent system prompts** - `2c631cd6ce` (feat)
2. **Task 2: Create legacy branch cleanup script** - `ab5931d50b` (feat)

## Files Created/Modified
- `src/execution/prompts.ts` - New file with FORK_WRITE_POLICY_INSTRUCTIONS constant for write-mode agents
- `src/handlers/mention.ts` - Import and append fork policy to writeInstructions
- `scripts/cleanup-legacy-branches.ts` - One-time script to delete kodiai/write-* and kodiai/slack/* branches

## Decisions Made
- Fork policy instructions added to write-mode prompt only (read-only assistant already blocks write operations)
- Prompt fragment centralized in src/execution/prompts.ts as an exportable constant for reuse
- Cleanup script defaults to dry-run for safety; requires explicit --no-dry-run to delete

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Dual enforcement achieved: code guard (Plan 02) + prompt instructions (this plan)
- Legacy branches can be cleaned up by running the script with appropriate credentials
- All three plans in phase 127 ready for integration testing

---
*Phase: 127-fork-based-write-mode-with-gist-patches*
*Completed: 2026-03-07*
