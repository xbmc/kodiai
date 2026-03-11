---
id: T02
parent: S02
milestone: M001
provides:
  - createWorkspaceManager factory with ephemeral workspace lifecycle
  - Shallow clone with token-based git auth
  - Branch name validation (injection prevention)
  - Token redaction in error messages
  - Stale workspace cleanup on startup
  - Job infrastructure fully wired into server startup
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 4min
verification_result: passed
completed_at: 2026-02-08
blocker_discovered: false
---
# T02: 02-job-infrastructure 02

**# Phase 2 Plan 2: Workspace Manager Summary**

## What Happened

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
