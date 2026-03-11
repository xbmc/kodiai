# T01: 23-telemetry-foundation 01

**Slice:** S02 — **Milestone:** M003

## Description

Create the TelemetryStore module with SQLite-backed persistent storage for execution telemetry, using TDD to ensure correctness of insert, purge, and checkpoint operations.

Purpose: TELEM-02 (storage layer exists), TELEM-04 (record schema), TELEM-06 (WAL mode), TELEM-07 (90-day retention), TELEM-08 (WAL checkpoint on startup + every 1000 writes). This is the foundation that handlers will write to in Plan 03.
Output: Working, tested TelemetryStore with all storage requirements satisfied.

## Must-Haves

- [ ] "TelemetryStore.record() inserts a row into the executions table with all TELEM-04 fields"
- [ ] "TelemetryStore.purgeOlderThan(90) deletes rows older than 90 days and returns the count"
- [ ] "TelemetryStore.checkpoint() runs WAL checkpoint without error"
- [ ] "Database uses WAL mode after initialization"
- [ ] "Auto-checkpoint triggers after 1000 writes"
- [ ] "Indexes exist on created_at and repo columns"

## Files

- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`
