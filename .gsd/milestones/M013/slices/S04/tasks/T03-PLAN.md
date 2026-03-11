# T03: 75-live-ops-verification-closure 03

**Slice:** S04 — **Milestone:** M013

## Description

Close the remaining Phase 75 verification blockers by hardening live evidence prerequisites, removing runtime author-cache noise from OPS capture runs, and collecting passing OPS75 closure artifacts.

Purpose: Verification is blocked by missing accepted review_requested lane evidence, absent degraded telemetry rows, and missing fail-open proof under forced telemetry write failure.
Output: A remediation plan that fixes author-cache live-write instability, tightens OPS75 preflight/evidence contracts, and captures a passing closure run tied to OPS75 check IDs.

## Must-Haves

- [ ] "Deterministic closure evidence includes accepted review_requested and explicit @kodiai mention lanes for the same OPS75 matrix run"
- [ ] "Live OPS75 evidence proves exactly one degraded telemetry row per degraded execution identity with duplicate checks passing"
- [ ] "Live OPS75 evidence proves fail-open completion under forced telemetry write failure without unrelated author-cache write faults"

## Files

- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `scripts/phase75-live-ops-verification-closure.ts`
- `docs/smoke/phase75-live-ops-verification-closure.md`
- `docs/runbooks/review-requested-debug.md`
