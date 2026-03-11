---
id: S02
parent: M001
milestone: M001
provides:
  - JobQueue interface with per-installation concurrency control
  - createJobQueue factory function
  - getInstallationToken method on GitHubApp for raw token access
  - CloneOptions, Workspace, WorkspaceManager type definitions
  - createWorkspaceManager factory with ephemeral workspace lifecycle
  - Shallow clone with token-based git auth
  - Branch name validation (injection prevention)
  - Token redaction in error messages
  - Stale workspace cleanup on startup
  - Job infrastructure fully wired into server startup
requires: []
affects: []
key_files: []
key_decisions:
  - "PQueue(concurrency: 1) per installation ensures sequential execution within an installation"
  - "Lazy queue creation + idle pruning prevents unbounded Map growth"
  - "getInstallationToken uses createAppAuth directly (not Octokit) for raw token access"
  - "queue.add() return cast to Promise<T> since void only occurs with throwOnTimeout"
  - "Branch validation rejects leading dash, control chars, .., .lock, @{, //, trailing / to prevent git injection"
  - "Token redacted from error messages/stack traces before re-throw to prevent credential leakage"
  - "Stale cleanup threshold is 1 hour for kodiai-* temp dirs"
  - "jobQueue and workspaceManager are local constants in index.ts (not module exports) until Phase 3 wiring"
  - "git clone uses --single-branch --depth=N and .quiet() to suppress token in error output"
patterns_established:
  - "Per-installation resource pattern: Map<number, Resource> with lazy creation and cleanup"
  - "Idle pruning pattern: check size === 0 && pending === 0 after job completion"
  - "Ephemeral workspace pattern: mkdtemp + clone + try/finally cleanup"
  - "Token redaction pattern: redactToken() strips credentials from Error.message and Error.stack"
  - "Startup cleanup pattern: cleanupStale() runs at boot for defense-in-depth"
observability_surfaces: []
drill_down_paths: []
duration: 4min
verification_result: passed
completed_at: 2026-02-08
blocker_discovered: false
---
# S02: Job Infrastructure

**# Phase 2 Plan 1: Job Queue Summary**

## What Happened

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

# Phase 2 Plan 2: Workspace Manager Summary

**Ephemeral workspace manager with shallow git clone via token auth, branch validation, token redaction, and stale cleanup wired into server startup**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-08T05:22:14Z
- **Completed:** 2026-02-08T05:26:22Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created createWorkspaceManager factory providing full ephemeral workspace lifecycle: mkdtemp, shallow clone with installation token auth, git identity config as kodiai[bot], and automatic cleanup
- Implemented comprehensive branch name validation preventing git option injection (leading dash), control chars, parent traversal (..), reflog syntax (@{), and other dangerous patterns
- Token redaction in error messages and stack traces ensures credentials never leak through thrown errors
- Stale workspace cleanup (kodiai-* dirs older than 1 hour) runs at server boot as defense-in-depth
- Wired jobQueue and workspaceManager into server startup sequence with Phase 3+ handler example comments

## Task Commits

Each task was committed atomically:

1. **Task 1: Create workspace manager with clone, auth, cleanup, and branch validation** - `ca7a17a` (feat)
2. **Task 2: Wire job infrastructure into server startup** - `b7aea9d` (feat)

## Files Created/Modified
- `src/jobs/workspace.ts` - createWorkspaceManager factory: ephemeral workspace creation with clone, auth, cleanup, branch validation, token redaction, stale cleanup
- `src/index.ts` - Added job infrastructure imports, creates jobQueue and workspaceManager, runs stale cleanup at boot

## Decisions Made
- Branch validation checks 9 distinct patterns (empty, leading dash, control chars, special git chars, non-alphanumeric start, parent traversal, .lock suffix, @{ reflog, trailing/consecutive slashes) with descriptive error messages for each
- Token is redacted from both Error.message and Error.stack before re-throw, preventing leakage through any error handling path
- git clone uses .quiet() to suppress stdout/stderr that may contain the token in error scenarios
- Temp dir cleanup on clone failure is wrapped in .catch(() => {}) so cleanup failure never masks the original error
- Stale cleanup uses stat().mtimeMs comparison with 1-hour threshold; individual entry failures are non-fatal (skipped with try/catch)
- jobQueue and workspaceManager remain local constants (not exported) -- Phase 3 will wire them into handler registration

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Full job infrastructure complete: JobQueue (per-installation concurrency) + WorkspaceManager (ephemeral clone workspaces)
- Both wired into server startup and ready for Phase 3 handler registration
- Handler pattern documented in index.ts comments: eventRouter.register -> jobQueue.enqueue -> workspaceManager.create -> try/finally cleanup
- All Phase 2 success criteria met: TypeScript compiles, factory pattern, token never logged, branch validation, stale cleanup

## Self-Check: PASSED

- All created files verified to exist on disk (src/jobs/workspace.ts)
- All commit hashes verified in git log (ca7a17a, b7aea9d)
- TypeScript compiles cleanly (bunx tsc --noEmit)
- Exports verified (createWorkspaceManager is a function)

---
*Phase: 02-job-infrastructure*
*Completed: 2026-02-08*
