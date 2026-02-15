---
phase: 23-telemetry-foundation
plan: 01
subsystem: database
tags: [sqlite, bun-sqlite, wal, telemetry, tdd]

# Dependency graph
requires: []
provides:
  - "TelemetryStore interface and factory function (createTelemetryStore)"
  - "TelemetryRecord type for execution telemetry data"
  - "SQLite-backed storage with WAL mode, prepared statements, auto-checkpoint"
  - "Retention purge (purgeOlderThan) and WAL checkpoint operations"
affects: [23-02, 23-03, 25-cli-reporter]

# Tech tracking
tech-stack:
  added: ["bun:sqlite (built-in)"]
  patterns: ["SQLite WAL mode with PASSIVE checkpoint", "RETURNING-based row counting for DELETE"]

key-files:
  created:
    - src/telemetry/types.ts
    - src/telemetry/store.ts
    - src/telemetry/store.test.ts

key-decisions:
  - "Used RETURNING clause for purge row counting instead of db.run().changes (avoids TypeScript type mismatch with db.run named params)"
  - "File-backed temp databases in tests for verification via second connection (in-memory DBs are per-connection)"

patterns-established:
  - "createTelemetryStore factory: same DI pattern as createJobQueue, createWorkspaceManager"
  - "bun:sqlite prepared statements with $-prefixed named parameters via db.query().run()"
  - "Auto-checkpoint every 1000 writes with internal counter reset"

# Metrics
duration: 3min
completed: 2026-02-11
---

# Phase 23 Plan 01: TelemetryStore Summary

**SQLite-backed TelemetryStore with WAL mode, prepared INSERT, 90-day retention purge, and auto-checkpoint every 1000 writes using bun:sqlite**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-11T19:51:24Z
- **Completed:** 2026-02-11T19:54:57Z
- **Tasks:** 4 (types, RED tests, GREEN implementation, REFACTOR cleanup)
- **Files modified:** 3

## Accomplishments
- TelemetryRecord type and TelemetryStore interface with full TELEM-04 field set
- createTelemetryStore factory function with WAL mode, NORMAL sync, busy_timeout PRAGMAs
- Prepared INSERT statement with $-prefixed named parameters for all 16 data columns
- purgeOlderThan(days) for 90-day retention with correct datetime math
- Auto-checkpoint at 1000 writes (TELEM-08) and manual checkpoint() method
- Indexes on created_at and repo columns for query performance
- 10 passing tests covering all must_have truths plus directory creation and index verification

## Task Commits

Each task was committed atomically:

1. **Task 1: TelemetryRecord type and TelemetryStore interface** - `d46ba72726` (feat)
2. **Task 2: Failing tests (RED)** - `e6fc822cbc` (test)
3. **Task 3: Store implementation (GREEN)** - `f5fd2cfd65` (feat)
4. **Task 4: Test cleanup (REFACTOR)** - `4f4759703b` (refactor)

## Files Created/Modified
- `src/telemetry/types.ts` - TelemetryRecord type and TelemetryStore interface (41 lines)
- `src/telemetry/store.ts` - createTelemetryStore factory with SQLite WAL, prepared statements, auto-checkpoint (128 lines)
- `src/telemetry/store.test.ts` - 10 tests covering insert, defaults, purge, WAL, checkpoint, close, auto-checkpoint, directory creation, indexes (237 lines)

## Decisions Made
- Used `db.query().all()` with RETURNING clause for purge instead of `db.run().changes` -- the TypeScript types for `db.run()` don't accept named parameter objects, only positional arrays. The RETURNING approach works correctly and sidesteps the type mismatch.
- Tests use file-backed temp databases (not :memory:) when verification requires opening a second connection, since in-memory databases are per-connection in SQLite.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type error in purgeOlderThan**
- **Found during:** Task 3 (GREEN implementation)
- **Issue:** `db.run()` second parameter typed as `SQLQueryBindings[]` (positional array), not accepting named parameter objects like `{ $modifier: ... }`
- **Fix:** Switched to `db.query("DELETE ... RETURNING id").all({ $modifier })` pattern which properly supports named parameters
- **Files modified:** src/telemetry/store.ts
- **Verification:** `bunx tsc --noEmit` passes, all tests pass
- **Committed in:** f5fd2cfd65 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial type-level fix. Same SQL behavior, different API surface. No scope creep.

## Issues Encountered
None beyond the TypeScript type mismatch documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TelemetryStore is ready for integration into handlers (Plan 03)
- Plan 02 (ExecutionResult enrichment) can proceed independently
- Factory function follows existing DI pattern, ready to initialize in index.ts

## Self-Check: PASSED

All files exist, all commits verified, all exports confirmed, all key links present.

---
*Phase: 23-telemetry-foundation*
*Completed: 2026-02-11*
