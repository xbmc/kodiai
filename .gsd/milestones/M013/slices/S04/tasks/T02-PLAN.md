# T02: 75-live-ops-verification-closure 02

**Slice:** S04 — **Milestone:** M013

## Description

Deliver the live-run verification harness and operator procedure that conclusively closes OPS-04 and OPS-05 with deterministic, evidence-cited pass/fail output.

Purpose: Phase 72 left OPS-04/OPS-05 requiring human/live proof; Phase 75 closes that gap with repeatable matrix execution and machine-checkable evidence criteria.
Output: New `verify:phase75` CLI, tests, and smoke/runbook instructions that prove cache hit/miss telemetry correctness, exactly-once degraded telemetry identity, and fail-open completion under telemetry write failure.

## Must-Haves

- [ ] "Operators can run one deterministic live verification matrix that covers cache prime-hit-miss identities for both review_requested and explicit @kodiai mention surfaces"
- [ ] "Verification output proves exactly one degraded telemetry event per degraded execution identity with duplicate detection checks"
- [ ] "Verification output proves degraded executions still complete when telemetry persistence is intentionally failed"
- [ ] "Final pass/fail verdict is machine-checkable and explicitly tied to check IDs and captured evidence"

## Files

- `scripts/phase75-live-ops-verification-closure.ts`
- `scripts/phase75-live-ops-verification-closure.test.ts`
- `package.json`
- `docs/smoke/phase75-live-ops-verification-closure.md`
- `docs/runbooks/review-requested-debug.md`
