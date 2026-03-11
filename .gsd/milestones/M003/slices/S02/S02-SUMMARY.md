---
id: S02
parent: M003
milestone: M003
provides:
  - ExecutionResult type with model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, stopReason fields
  - Executor extraction of SDK modelUsage into ExecutionResult on success path
  - Undefined token fields on error/timeout paths for backward compatibility
  - "TelemetryStore interface and factory function (createTelemetryStore)"
  - "TelemetryRecord type for execution telemetry data"
  - "SQLite-backed storage with WAL mode, prepared statements, auto-checkpoint"
  - "Retention purge (purgeOlderThan) and WAL checkpoint operations"
  - "Full telemetry pipeline: handler execution -> TelemetryStore.record() -> SQLite"
  - "TelemetryStore initialization at server startup with configurable DB path"
  - "90-day retention purge and WAL checkpoint on startup"
  - "Fire-and-forget telemetry capture in review and mention handlers"
  - "Dockerfile /app/data directory for SQLite database"
requires: []
affects: []
key_files: []
key_decisions:
  - "All new ExecutionResult fields use `| undefined` (not optional) for explicit backward compatibility"
  - "Token counts summed across all model entries in modelUsage (supports multi-model executions)"
  - "Primary model taken from first modelUsage entry, falls back to 'unknown'"
  - "Error/timeout paths set all token fields to undefined (not zero) to distinguish from zero-token executions"
  - "Used RETURNING clause for purge row counting instead of db.run().changes (avoids TypeScript type mismatch with db.run named params)"
  - "File-backed temp databases in tests for verification via second connection (in-memory DBs are per-connection)"
  - "model field defaults to 'unknown' when ExecutionResult.model is undefined (error/timeout paths)"
  - "Telemetry capture is inside its own try-catch, separate from handler main try-catch (TELEM-05 non-blocking)"
patterns_established:
  - "SDK data extraction pattern: Object.entries(resultMessage.modelUsage ?? {}).reduce() for summing token fields"
  - "createTelemetryStore factory: same DI pattern as createJobQueue, createWorkspaceManager"
  - "bun:sqlite prepared statements with $-prefixed named parameters via db.query().run()"
  - "Auto-checkpoint every 1000 writes with internal counter reset"
  - "Fire-and-forget telemetry: try { store.record({...}) } catch { logger.warn } after every execution"
  - "noopTelemetryStore test mock: { record: () => {}, purgeOlderThan: () => 0, checkpoint: () => {}, close: () => {} }"
observability_surfaces: []
drill_down_paths: []
duration: 4min
verification_result: passed
completed_at: 2026-02-11
blocker_discovered: false
---
# S02: Telemetry Foundation

**# Phase 23 Plan 02: ExecutionResult Token Enrichment Summary**

## What Happened

# Phase 23 Plan 02: ExecutionResult Token Enrichment Summary

**ExecutionResult enriched with 6 TELEM-01 fields (model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, stopReason) extracted from SDK modelUsage**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-11T19:51:13Z
- **Completed:** 2026-02-11T19:53:32Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added 6 new optional fields to ExecutionResult type for TELEM-01 token tracking
- Executor success path sums inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens across all model entries in SDK modelUsage
- All 4 executor return paths (success, no-result, timeout, error) include the new fields
- Zero handler code changes -- fully backward compatible

## Task Commits

Each task was committed atomically:

1. **Task 1: Add token fields to ExecutionResult type** - `d46ba72726` (feat)
2. **Task 2: Extract SDK modelUsage into ExecutionResult in executor** - `e6fc822cbc` (feat)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `src/execution/types.ts` - Added model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, stopReason fields to ExecutionResult
- `src/execution/executor.ts` - Added SDK modelUsage extraction on success path; undefined fields on error/timeout/no-result paths

## Decisions Made
- All new fields use `| undefined` (not `?:` optional) for explicit backward compat -- existing destructuring gets `undefined`
- Token counts summed across all model entries (usually one, but handles multi-model)
- Primary model from first modelUsage key, falls back to "unknown" when empty
- Error/timeout paths use `undefined` (not `0`) to distinguish "no data" from "zero tokens"

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing `tsc --noEmit` failure from `src/telemetry/store.test.ts` importing not-yet-created `store.ts` (23-01 TDD RED phase artifact). Unrelated to this plan's changes. All 160 tests pass via `bun test`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ExecutionResult now carries full SDK token data for plan 23-03 (TelemetryStore) to consume
- Handler code unchanged -- plan 23-03 will add telemetry capture calls in handlers

## Self-Check: PASSED

All files exist, all commits verified, all must-have artifacts confirmed.

---
*Phase: 23-telemetry-foundation*
*Completed: 2026-02-11*

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

# Phase 23 Plan 03: Telemetry Pipeline Wiring Summary

**TelemetryStore initialized at startup with 90-day purge, fire-and-forget capture wired into both review and mention handlers, Dockerfile data directory added**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-11T19:57:58Z
- **Completed:** 2026-02-11T20:02:25Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- TelemetryStore initialized in server startup with configurable TELEMETRY_DB_PATH env var
- 90-day retention purge and WAL checkpoint run automatically on every server boot
- Review handler records telemetry for every PR execution (success, failure, error)
- Mention handler records telemetry for every mention execution (success, failure, error)
- Telemetry writes are fire-and-forget: failures logged as warnings, never block critical path
- Dockerfile creates /app/data directory with correct bun user ownership
- All 160 existing tests pass with noopTelemetryStore mock in 25 handler test sites

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize TelemetryStore in server startup and update Dockerfile** - `968715c1bc` (feat)
2. **Task 2: Add fire-and-forget telemetry capture to review and mention handlers** - `4715cb9316` (feat)

## Files Created/Modified
- `src/index.ts` - TelemetryStore import, initialization, startup purge/checkpoint, injection into both handlers
- `src/handlers/review.ts` - TelemetryStore in deps type, fire-and-forget record() after executor.execute()
- `src/handlers/mention.ts` - TelemetryStore in deps type, fire-and-forget record() after executor.execute()
- `Dockerfile` - RUN mkdir -p /app/data && chown bun:bun /app/data before USER bun
- `src/handlers/review.test.ts` - noopTelemetryStore mock added to 13 handler construction sites
- `src/handlers/mention.test.ts` - noopTelemetryStore mock added to 12 handler construction sites

## Decisions Made
- `result.model ?? "unknown"` fallback: TelemetryRecord.model is required (string), but ExecutionResult.model is `string | undefined`. Error/timeout paths have undefined model, so we fall back to "unknown" rather than making the TelemetryRecord field optional.
- Telemetry capture placement: after the "execution completed" log line but before any post-execution logic (error comment posting, auto-approval, write-mode branch/PR creation). This ensures telemetry is recorded for ALL outcomes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type mismatch for model field**
- **Found during:** Task 2 (handler telemetry capture)
- **Issue:** `result.model` is `string | undefined` (ExecutionResult) but `TelemetryRecord.model` requires `string`. TypeScript correctly rejected the assignment.
- **Fix:** Added `?? "unknown"` fallback for model in both handlers
- **Files modified:** src/handlers/review.ts, src/handlers/mention.ts
- **Verification:** `bunx tsc --noEmit` passes
- **Committed in:** 4715cb9316 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial type-level fix. Same semantics, explicit fallback for undefined model. No scope creep.

## Issues Encountered
None beyond the TypeScript type mismatch documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 23 (Telemetry Foundation) is complete: SDK data flows through ExecutionResult into TelemetryStore via SQLite
- The telemetry database is created at ./data/kodiai-telemetry.db (or TELEMETRY_DB_PATH env var)
- Future CLI reporter (Phase 25) can read the SQLite database while the server is running (WAL mode)
- Deployment: next deploy will automatically create the data directory and start recording telemetry

## Self-Check: PASSED

All files exist, all commits verified, all must-have artifacts confirmed.

---
*Phase: 23-telemetry-foundation*
*Completed: 2026-02-11*
