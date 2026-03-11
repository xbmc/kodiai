# S02: Telemetry Foundation

**Goal:** Create the TelemetryStore module with SQLite-backed persistent storage for execution telemetry, using TDD to ensure correctness of insert, purge, and checkpoint operations.
**Demo:** Create the TelemetryStore module with SQLite-backed persistent storage for execution telemetry, using TDD to ensure correctness of insert, purge, and checkpoint operations.

## Must-Haves


## Tasks

- [x] **T01: 23-telemetry-foundation 01** `est:3min`
  - Create the TelemetryStore module with SQLite-backed persistent storage for execution telemetry, using TDD to ensure correctness of insert, purge, and checkpoint operations.

Purpose: TELEM-02 (storage layer exists), TELEM-04 (record schema), TELEM-06 (WAL mode), TELEM-07 (90-day retention), TELEM-08 (WAL checkpoint on startup + every 1000 writes). This is the foundation that handlers will write to in Plan 03.
Output: Working, tested TelemetryStore with all storage requirements satisfied.
- [x] **T02: 23-telemetry-foundation 02** `est:2min`
  - Enrich ExecutionResult with per-model token data (inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens), model name, and stopReason extracted from the Claude Agent SDK's SDKResultMessage.

Purpose: TELEM-01 requires ExecutionResult to include full SDK data so handlers can pass it to the telemetry store. This plan adds the fields and extraction logic without changing any handler code.
Output: Updated ExecutionResult type and executor that populates the new fields.
- [x] **T03: 23-telemetry-foundation 03** `est:4min`
  - Wire the TelemetryStore into the server startup and both handlers so every execution is recorded to SQLite, with fire-and-forget semantics ensuring telemetry never blocks the critical path.

Purpose: TELEM-03 (handlers capture telemetry), TELEM-05 (non-blocking writes), plus startup purge (TELEM-07) and Dockerfile data directory. This completes the telemetry pipeline: SDK data -> ExecutionResult -> handler -> TelemetryStore -> SQLite.
Output: Fully wired telemetry capture for review and mention executions.

## Files Likely Touched

- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`
- `src/execution/types.ts`
- `src/execution/executor.ts`
- `src/index.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
- `Dockerfile`
