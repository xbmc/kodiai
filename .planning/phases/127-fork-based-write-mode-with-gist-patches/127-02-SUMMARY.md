---
phase: 127-fork-based-write-mode-with-gist-patches
plan: 02
subsystem: write-mode
tags: [fork, gist, workspace, mention, slack, cross-fork-pr]

requires:
  - BotUserClient from 127-01
  - ForkManager from 127-01
  - GistPublisher from 127-01
provides:
  - Fork-aware workspace creation via forkContext in CloneOptions
  - Output routing helper shouldUseGist for gist vs PR selection
  - Push guard assertOriginIsFork for preventing direct target repo pushes
  - Fork-based mention handler write flow with gist/PR routing
  - Fork-based Slack write-runner with gist/PR routing
  - Cross-fork PR creation with forkOwner:branchName head format
  - Fallback to gist on fork/PR failure
  - Backward compatibility when BOT_USER_PAT not configured
affects: [127-03]

tech-stack:
  added: []
  patterns: [fork-context-pattern, output-routing-pattern, cross-fork-pr-pattern, gist-fallback-pattern]

key-files:
  created: []
  modified:
    - src/jobs/types.ts
    - src/jobs/workspace.ts
    - src/handlers/mention.ts
    - src/slack/write-runner.ts
    - src/index.ts

key-decisions:
  - "Fork setup (ensureFork + syncFork) happens before workspace creation, with forkContext passed through CloneOptions"
  - "shouldUseGist uses keyword-first routing, then file count heuristic (1 file = gist, >3 = PR, 2-3 same dir = gist)"
  - "Fork-based write path is inserted before legacy path in mention.ts -- falls through to legacy on complete failure"
  - "Slack write-runner result type updated with optional gistUrl alongside prUrl for gist outcomes"

patterns-established:
  - "Fork context pattern: optional forkContext in CloneOptions enables fork-aware cloning without changing WorkspaceManager interface"
  - "Output routing pattern: shouldUseGist as shared helper used by both mention.ts and write-runner.ts"
  - "Graceful degradation chain: fork PR -> gist fallback -> legacy direct push"

requirements-completed: [FORK-04, FORK-05, FORK-06, FORK-07, FORK-08]

duration: 6min
completed: 2026-03-07
---

# Phase 127 Plan 02: Wire Fork/Gist into Write-Mode Flows Summary

**Fork-aware workspace creation with output routing (gist vs cross-fork PR), fallback chain, and backward compatibility**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-07T21:53:21Z
- **Completed:** 2026-03-07T21:59:58Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- CloneOptions extended with optional forkContext for bot-owned fork cloning
- Workspace.create clones from fork URL when forkContext provided, adds upstream remote for reference
- assertOriginIsFork guard prevents accidental direct pushes to target repos
- shouldUseGist routing helper uses keyword priority then file count/directory heuristic
- Mention handler write flow: ensureFork + syncFork before workspace creation, gist/PR output routing, cross-fork PR with forkOwner:branchName head, fallback to gist on failure
- Slack write-runner: fork-aware workspace creation, same output routing and fallback chain
- BotUserClient, ForkManager, GistPublisher initialized in index.ts and passed to both handlers
- Both flows backward compatible when BOT_USER_PAT not configured (logged warning, legacy behavior)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fork-aware workspace creation and output routing helper** - `4fb38b3e33` (feat)
2. **Task 2: Wire fork/gist into mention handler, write-runner, and index.ts** - `1fd7202856` (feat)

## Files Created/Modified
- `src/jobs/types.ts` - Added forkContext to CloneOptions interface
- `src/jobs/workspace.ts` - Fork-aware create(), assertOriginIsFork guard, shouldUseGist helper
- `src/handlers/mention.ts` - Fork setup before workspace creation, gist/PR output routing, cross-fork PR, fallback chain
- `src/slack/write-runner.ts` - Fork-aware workspace, gist output path, cross-fork PR, updated result type with gistUrl
- `src/index.ts` - BotUserClient/ForkManager/GistPublisher initialization and wiring to handlers

## Decisions Made
- Fork setup (ensureFork + syncFork) happens before workspace creation, with forkContext passed through CloneOptions to avoid changing the WorkspaceManager interface
- shouldUseGist uses keyword-first routing (patch -> gist, pr -> PR), then file count heuristic (1 file = gist, >3 = PR, 2-3 in same dir = gist)
- Fork-based write path inserted before legacy path -- falls through to legacy on complete failure, providing a graceful degradation chain
- SlackWriteRunnerResult success variant updated with optional gistUrl alongside prUrl

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-existing Plan 03 commit for fork-only instructions**
- **Found during:** Task 2
- **Issue:** A commit from 127-03-PLAN.md (feat(127-03): add fork-only instructions) had already landed, adding `src/execution/prompts.ts` and importing `FORK_WRITE_POLICY_INSTRUCTIONS` in mention.ts
- **Fix:** Worked with existing state rather than reverting -- the import was already present, so the fork instructions are already wired into write-mode prompts
- **Files affected:** src/handlers/mention.ts (import already present), src/execution/prompts.ts (already created)

## Issues Encountered
None beyond the pre-existing Plan 03 commit noted above.

## Next Phase Readiness
- All fork-based write mode flows are wired and ready for Plan 03 testing/verification
- The write-mode agent instructions from the pre-existing Plan 03 commit are already in place

---
*Phase: 127-fork-based-write-mode-with-gist-patches*
*Completed: 2026-03-07*
