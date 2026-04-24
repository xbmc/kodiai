# S02: S02 — UAT

**Milestone:** M064
**Written:** 2026-04-24T07:54:34.106Z

# UAT — M064/S02 Canonical continuation-family orchestration hardening

## Preconditions
- Run from repository root with Bun available.
- No external services are required; scenarios use the repository test/verifier harnesses.
- Canonical continuation-family assertions are read from verifier output, not from checkpoint JSON or telemetry rows.

## Test Case 1 — Checkpoint acknowledgement is truthful
1. Run `bun test src/execution/mcp/checkpoint-server.test.ts`.
   - Expected: 5 tests pass.
2. Confirm the suite includes `waits for checkpoint persistence before reporting success`.
   - Expected: the handler promise remains pending until the deferred checkpoint save resolves.
3. Confirm the suite includes `returns an error result when checkpoint persistence fails`.
   - Expected: a rejected save returns the error path and never reports `saved: true`.

## Test Case 2 — Retry enqueue failure does not leave canonical state pending
1. Run `bun run verify:m064:s02 -- --json`.
2. Inspect the `retry-enqueue-failure` scenario.
   - Expected: `success: true`.
   - Expected: `authoritativeOutcome` is `blocked`.
   - Expected: `finalStopReason` is `no-follow-up`.
   - Expected: `authoritativeAttemptId` is `review-work-2`.
   - Expected: `projectionStatus` is `canonical`.
   - Expected: no scenario issue indicates fallback to checkpoints or telemetry.

## Test Case 3 — Retry execution failure finalizes canonical truth before cleanup
1. In the same verifier output, inspect `retry-execution-failure`.
   - Expected: `success: true`.
   - Expected: `authoritativeOutcome` is `blocked`.
   - Expected: `finalStopReason` is `no-follow-up`.
   - Expected: `authoritativeAttemptId` is `review-work-2`.
   - Expected: `projectionStatus` remains `canonical`.
2. Run `bun test src/handlers/review.test.ts`.
   - Expected: 146 tests pass, including the canonical continuation-family coverage for retry failure paths.

## Test Case 4 — Projection degradation is explicit without changing lifecycle truth
1. In verifier output, inspect `telemetry-projection-degraded`.
   - Expected: `success: true`.
   - Expected: `authoritativeOutcome` is `blocked`.
   - Expected: `finalStopReason` is `no-follow-up`.
   - Expected: `projectionStatus` is `degraded`.
   - Expected: authoritative fields are still present and derived from the canonical continuation-family row.

## Test Case 5 — Stale retry cannot overwrite newer authority
1. In verifier output, inspect `superseded-stale-retry`.
   - Expected: `success: true`.
   - Expected: `authoritativeOutcome` is `superseded`.
   - Expected: `finalStopReason` is `superseded-by-newer-attempt`.
   - Expected: `authoritativeAttemptId` is `review-work-3`.
   - Expected: `supersededByAttemptId` is `review-work-3`.
   - Expected: the `supersession-shield` check passes.
2. Confirm no older attempt is reported as authoritative after supersession.

## Test Case 6 — Full slice proof stays green together
1. Run `bun test src/execution/mcp/checkpoint-server.test.ts && bun test src/handlers/review.test.ts && bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s02 -- --json`.
   - Expected: all commands exit 0.
   - Expected: final verifier status is `m064_s02_ok`.

## Edge Cases Covered
- Deferred checkpoint persistence that has not resolved yet.
- Rejected checkpoint writes.
- Retry enqueue failure after continuation scheduling.
- Retry execution exceptions after queued retry starts.
- Telemetry projection write failure with canonical truth preserved.
- Older retry finishing after a newer attempt has already taken authority.
