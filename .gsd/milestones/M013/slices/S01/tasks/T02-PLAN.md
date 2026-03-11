# T02: 72-telemetry-follow-through 02

**Slice:** S01 — **Milestone:** M013

## Description

Ship a deterministic live verification harness for OPS-04/OPS-05 with operator-readable evidence artifacts.

Purpose: Phase 72 is complete only when operators can repeatedly prove cache-hit telemetry correctness and exactly-once/non-blocking degraded telemetry behavior from live-triggered runs, including both required trigger surfaces.
Output: One executable verification script plus smoke/runbook instructions that produce DB assertions and a human-readable reliability summary once per milestone.

## Must-Haves

- [ ] "Operator can run one deterministic, scripted verification sequence that covers both review_requested and explicit @kodiai mention surfaces"
- [ ] "Verification sequence includes prime -> hit -> changed-query miss and proves cache-hit telemetry reflects all three outcomes"
- [ ] "Operator receives two-layer evidence: DB-level assertions for exactly-once/non-blocking guarantees and a human-readable milestone summary"
- [ ] "Reliability wording stays subtle and evidence-bound: risk acknowledgement in analysis text, no certainty claims without proof"

## Files

- `scripts/phase72-telemetry-follow-through.ts`
- `scripts/phase72-telemetry-follow-through.test.ts`
- `package.json`
- `docs/smoke/phase72-telemetry-follow-through.md`
- `docs/runbooks/review-requested-debug.md`
