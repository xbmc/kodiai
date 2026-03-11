# T01: 72-telemetry-follow-through 01

**Slice:** S01 — **Milestone:** M013

## Description

Lock OPS-05 runtime guarantees so degraded executions always emit exactly-once telemetry without risking review completion.

Purpose: Phase 72 requires production-safe proof that telemetry idempotency and non-blocking behavior hold under real retry/degraded conditions, with duplicate emission treated as a milestone failure.
Output: Composite telemetry identity in persistence, deterministic once-per-run emission wiring, and regression coverage that fails on duplicate emission or blocking write behavior.

## Must-Haves

- [ ] "A degraded execution writes at most one rate-limit telemetry row for the same delivery/event identity, even when retry logic runs"
- [ ] "Exactly-once identity for rate-limit telemetry is keyed by delivery_id plus event type, and duplicate emission for the same pair is impossible"
- [ ] "If rate-limit telemetry persistence throws, review execution still completes and publishes its normal output path"

## Files

- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
