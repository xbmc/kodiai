---
phase: 23-telemetry-foundation
plan: 03
subsystem: telemetry
tags: [sqlite, telemetry, handlers, fire-and-forget, non-blocking]

# Dependency graph
requires:
  - phase: 23-01
    provides: "TelemetryStore interface, createTelemetryStore factory, SQLite WAL storage"
  - phase: 23-02
    provides: "ExecutionResult with model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, stopReason fields"
provides:
  - "Full telemetry pipeline: handler execution -> TelemetryStore.record() -> SQLite"
  - "TelemetryStore initialization at server startup with configurable DB path"
  - "90-day retention purge and WAL checkpoint on startup"
  - "Fire-and-forget telemetry capture in review and mention handlers"
  - "Dockerfile /app/data directory for SQLite database"
affects: [25-cli-reporter, deploy]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Fire-and-forget telemetry via isolated try-catch around store.record()"]

key-files:
  created: []
  modified:
    - src/index.ts
    - src/handlers/review.ts
    - src/handlers/mention.ts
    - Dockerfile
    - src/handlers/review.test.ts
    - src/handlers/mention.test.ts

key-decisions:
  - "model field defaults to 'unknown' when ExecutionResult.model is undefined (error/timeout paths)"
  - "Telemetry capture is inside its own try-catch, separate from handler main try-catch (TELEM-05 non-blocking)"

patterns-established:
  - "Fire-and-forget telemetry: try { store.record({...}) } catch { logger.warn } after every execution"
  - "noopTelemetryStore test mock: { record: () => {}, purgeOlderThan: () => 0, checkpoint: () => {}, close: () => {} }"

# Metrics
duration: 4min
completed: 2026-02-11
---

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
