# T03: 23-telemetry-foundation 03

**Slice:** S02 — **Milestone:** M003

## Description

Wire the TelemetryStore into the server startup and both handlers so every execution is recorded to SQLite, with fire-and-forget semantics ensuring telemetry never blocks the critical path.

Purpose: TELEM-03 (handlers capture telemetry), TELEM-05 (non-blocking writes), plus startup purge (TELEM-07) and Dockerfile data directory. This completes the telemetry pipeline: SDK data -> ExecutionResult -> handler -> TelemetryStore -> SQLite.
Output: Fully wired telemetry capture for review and mention executions.

## Must-Haves

- [ ] "After a PR review completes, a telemetry row exists in SQLite with deliveryId, repo, prNumber, eventType, model, inputTokens, outputTokens, costUsd, and durationMs"
- [ ] "After a mention execution completes, the same telemetry fields are recorded with a different eventType"
- [ ] "Telemetry writes do not delay the next queued job -- a failed write never blocks the critical path"
- [ ] "Rows older than 90 days are automatically deleted on startup"
- [ ] "The SQLite database uses WAL mode and can be read by an external process while the server is running"
- [ ] "Dockerfile creates /app/data directory with correct ownership before USER bun"

## Files

- `src/index.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
- `Dockerfile`
