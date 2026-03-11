# T04: 75-live-ops-verification-closure 04

**Slice:** S04 — **Milestone:** M013

## Description

Close the remaining Phase 75 verification gaps by capturing a fresh live OPS75 evidence bundle that proves mention-lane coverage and degraded exactly-once telemetry rows in the same deterministic matrix run.

Purpose: Plan 75-03 fixed tooling and preflight contracts, but closure is still blocked because sampled live identities did not include persisted mention-lane rows or degraded rows with `degradation_path != none`.
Output: Updated smoke and debug docs with fresh run identities plus verifier output showing all previously failing OPS75 checks now pass.

## Must-Haves

- [ ] "Deterministic closure evidence includes accepted review_requested and explicit @kodiai mention lanes for the same OPS75 matrix run"
- [ ] "Live OPS75 evidence proves exactly one degraded telemetry row per degraded execution identity with duplicate checks passing"
- [ ] "OPS75 closure evidence bundle records OPS75-PREFLIGHT-01, OPS75-CACHE-02, OPS75-ONCE-01, and OPS75-ONCE-02 as PASS in one run output"

## Files

- `docs/smoke/phase75-live-ops-verification-closure.md`
- `docs/runbooks/review-requested-debug.md`
