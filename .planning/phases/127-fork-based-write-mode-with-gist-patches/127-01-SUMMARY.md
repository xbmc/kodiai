---
phase: 127-fork-based-write-mode-with-gist-patches
plan: 01
subsystem: auth
tags: [github, octokit, pat, fork, gist]

requires: []
provides:
  - BotUserClient with PAT-authenticated Octokit for fork/gist operations
  - ForkManager for lazy fork creation, upstream sync, branch cleanup
  - GistPublisher for secret gist creation with patch content
  - Config schema with BOT_USER_PAT and BOT_USER_LOGIN env vars
affects: [127-02, 127-03]

tech-stack:
  added: []
  patterns: [bot-user-client-pattern, disabled-stub-pattern]

key-files:
  created:
    - src/auth/bot-user.ts
    - src/jobs/fork-manager.ts
    - src/jobs/gist-publisher.ts
  modified:
    - src/config.ts

key-decisions:
  - "BotUserClient uses getter-based stub that throws on access when disabled, matching existing factory patterns"
  - "ForkManager accepts botPat as explicit parameter rather than extracting from Octokit internals"
  - "Fork cache is keyed by upstream owner/repo, not fork coordinates"

patterns-established:
  - "Disabled stub pattern: factory returns interface with enabled=false where methods throw descriptive errors"
  - "Bot user PAT passed explicitly to modules that need raw token access"

requirements-completed: [FORK-01, FORK-02, FORK-03]

duration: 2min
completed: 2026-03-07
---

# Phase 127 Plan 01: Bot User Auth, Fork Manager, and Gist Publisher Summary

**PAT-authenticated BotUserClient with ForkManager (lazy creation, sync, cache) and GistPublisher (secret gist creation) modules**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-07T21:48:39Z
- **Completed:** 2026-03-07T21:50:47Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Config schema extended with BOT_USER_PAT and BOT_USER_LOGIN env vars (empty defaults for graceful degradation)
- BotUserClient provides PAT-authenticated Octokit or disabled stub when credentials not set
- ForkManager handles lazy fork creation with in-memory cache, upstream sync via merge-upstream API, and best-effort branch cleanup
- GistPublisher creates secret gists with timestamped patch filenames

## Task Commits

Each task was committed atomically:

1. **Task 1: Add bot user config and create BotUserClient** - `144911b5d0` (feat)
2. **Task 2: Create ForkManager and GistPublisher modules** - `973b7ed249` (feat)

## Files Created/Modified
- `src/config.ts` - Added botUserPat and botUserLogin fields with env var mappings
- `src/auth/bot-user.ts` - BotUserClient interface and createBotUserClient factory
- `src/jobs/fork-manager.ts` - ForkManager with ensureFork, syncFork, deleteForkBranch, getBotPat
- `src/jobs/gist-publisher.ts` - GistPublisher with createPatchGist for secret gist creation

## Decisions Made
- BotUserClient uses a getter-based stub that throws on octokit access when disabled, following the existing createGitHubApp factory pattern
- ForkManager accepts botPat as an explicit parameter to getBotPat rather than trying to extract it from Octokit internals
- Fork cache is keyed by upstream `owner/repo` to handle GitHub fork name collisions (e.g. `utils-1`)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

Bot user account configuration is required before fork/gist features can be used:
- `BOT_USER_PAT` - GitHub PAT with `repo` and `gist` scopes from a dedicated bot account
- `BOT_USER_LOGIN` - GitHub username of the bot account

Features degrade gracefully (disabled) when these are not set.

## Next Phase Readiness
- All three foundation modules ready for Plan 02 to wire into write-mode flows
- BotUserClient, ForkManager, and GistPublisher interfaces stable for integration

---
*Phase: 127-fork-based-write-mode-with-gist-patches*
*Completed: 2026-03-07*
