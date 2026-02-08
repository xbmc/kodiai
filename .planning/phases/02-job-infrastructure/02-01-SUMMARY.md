---
phase: 02-job-infrastructure
plan: 01
subsystem: infra
tags: [p-queue, concurrency, job-queue, github-app, installation-token]

# Dependency graph
requires:
  - phase: 01-webhook-foundation
    provides: GitHubApp interface with createAppAuth, AppConfig, Logger
provides:
  - JobQueue interface with per-installation concurrency control
  - createJobQueue factory function
  - getInstallationToken method on GitHubApp for raw token access
  - CloneOptions, Workspace, WorkspaceManager type definitions
affects: [02-02 workspace-manager, 03-review-execution]

# Tech tracking
tech-stack:
  added: [p-queue v9.1.0]
  patterns: [per-installation concurrency Map, lazy queue creation, idle queue pruning]

key-files:
  created:
    - src/jobs/types.ts
    - src/jobs/queue.ts
  modified:
    - src/auth/github-app.ts
    - package.json

key-decisions:
  - "PQueue(concurrency: 1) per installation ensures sequential execution within an installation"
  - "Lazy queue creation + idle pruning prevents unbounded Map growth"
  - "getInstallationToken uses createAppAuth directly (not Octokit) for raw token access"
  - "queue.add() return cast to Promise<T> since void only occurs with throwOnTimeout"

patterns-established:
  - "Per-installation resource pattern: Map<number, Resource> with lazy creation and cleanup"
  - "Idle pruning pattern: check size === 0 && pending === 0 after job completion"

# Metrics
duration: 4min
completed: 2026-02-08
---

# Phase 2 Plan 1: Job Queue Summary

**Per-installation job queue with p-queue concurrency control and GitHubApp raw token access via getInstallationToken**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-08T05:13:52Z
- **Completed:** 2026-02-08T05:18:06Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Installed p-queue v9.1.0 and created comprehensive job/workspace type definitions
- Implemented createJobQueue factory with per-installation PQueue(concurrency: 1) ensuring sequential execution within each installation while allowing parallelism across installations
- Extended GitHubApp interface with getInstallationToken() for raw token access needed by workspace cloning
- Verified concurrent behavior: same-installation sequential, cross-installation parallel, idle queue pruning

## Task Commits

Each task was committed atomically:

1. **Task 1: Install p-queue and create job types** - `486ea0e` (feat)
2. **Task 2: Create job queue and extend GitHubApp** - `97e0898` (feat)

## Files Created/Modified
- `src/jobs/types.ts` - CloneOptions, Workspace, JobQueue, WorkspaceManager interfaces
- `src/jobs/queue.ts` - createJobQueue factory with per-installation PQueue concurrency control
- `src/auth/github-app.ts` - Added getInstallationToken() to interface and implementation
- `package.json` - Added p-queue ^9.1.0 dependency

## Decisions Made
- PQueue concurrency: 1 per installation ensures only one job runs per installation at a time (prevents race conditions on shared repo state)
- Lazy queue creation avoids pre-allocating resources for installations that haven't submitted jobs
- Idle pruning (delete queue when size === 0 and pending === 0) prevents Map from growing unbounded over time
- Used createAppAuth directly for getInstallationToken rather than going through Octokit -- raw token is needed for git URL authentication, not API calls
- Cast queue.add() return to Promise<T> since the void case only applies when throwOnTimeout is configured (which we don't use)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- JobQueue and type definitions ready for Plan 02 (workspace manager)
- getInstallationToken available for git clone URL authentication in workspace manager
- All success criteria met: per-installation concurrency, parallel cross-installation, idle pruning, clean TypeScript compilation

## Self-Check: PASSED

- All created files verified to exist on disk
- All commit hashes verified in git log
- TypeScript compiles cleanly (bunx tsc --noEmit)
- Functional tests pass (sequential, parallel, pruning)

---
*Phase: 02-job-infrastructure*
*Completed: 2026-02-08*
