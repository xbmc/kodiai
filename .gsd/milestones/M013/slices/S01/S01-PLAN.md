# S01: Telemetry Follow Through

**Goal:** Lock OPS-05 runtime guarantees so degraded executions always emit exactly-once telemetry without risking review completion.
**Demo:** Lock OPS-05 runtime guarantees so degraded executions always emit exactly-once telemetry without risking review completion.

## Must-Haves


## Tasks

- [x] **T01: 72-telemetry-follow-through 01** `est:7 min`
  - Lock OPS-05 runtime guarantees so degraded executions always emit exactly-once telemetry without risking review completion.

Purpose: Phase 72 requires production-safe proof that telemetry idempotency and non-blocking behavior hold under real retry/degraded conditions, with duplicate emission treated as a milestone failure.
Output: Composite telemetry identity in persistence, deterministic once-per-run emission wiring, and regression coverage that fails on duplicate emission or blocking write behavior.
- [x] **T02: 72-telemetry-follow-through 02** `est:5 min`
  - Ship a deterministic live verification harness for OPS-04/OPS-05 with operator-readable evidence artifacts.

Purpose: Phase 72 is complete only when operators can repeatedly prove cache-hit telemetry correctness and exactly-once/non-blocking degraded telemetry behavior from live-triggered runs, including both required trigger surfaces.
Output: One executable verification script plus smoke/runbook instructions that produce DB assertions and a human-readable reliability summary once per milestone.

## Files Likely Touched

- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `scripts/phase72-telemetry-follow-through.ts`
- `scripts/phase72-telemetry-follow-through.test.ts`
- `package.json`
- `docs/smoke/phase72-telemetry-follow-through.md`
- `docs/runbooks/review-requested-debug.md`
