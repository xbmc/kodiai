# S04: Live Ops Verification Closure

**Goal:** Add deterministic runtime hooks and regressions that let operators reproduce OPS-05 fail-open telemetry-write failure behavior with execution-identity precision.
**Demo:** Add deterministic runtime hooks and regressions that let operators reproduce OPS-05 fail-open telemetry-write failure behavior with execution-identity precision.

## Must-Haves


## Tasks

- [x] **T01: 75-live-ops-verification-closure 01** `est:1 min`
  - Add deterministic runtime hooks and regressions that let operators reproduce OPS-05 fail-open telemetry-write failure behavior with execution-identity precision.

Purpose: Phase 75 requires live evidence for exactly-once degraded telemetry and non-blocking completion under persistence faults, not only code-level confidence.
Output: Verification-safe telemetry failure-injection controls plus regression coverage proving degraded executions complete without duplicate telemetry writes.
- [x] **T02: 75-live-ops-verification-closure 02** `est:13 min`
  - Deliver the live-run verification harness and operator procedure that conclusively closes OPS-04 and OPS-05 with deterministic, evidence-cited pass/fail output.

Purpose: Phase 72 left OPS-04/OPS-05 requiring human/live proof; Phase 75 closes that gap with repeatable matrix execution and machine-checkable evidence criteria.
Output: New `verify:phase75` CLI, tests, and smoke/runbook instructions that prove cache hit/miss telemetry correctness, exactly-once degraded telemetry identity, and fail-open completion under telemetry write failure.
- [x] **T03: 75-live-ops-verification-closure 03** `est:6 min`
  - Close the remaining Phase 75 verification blockers by hardening live evidence prerequisites, removing runtime author-cache noise from OPS capture runs, and collecting passing OPS75 closure artifacts.

Purpose: Verification is blocked by missing accepted review_requested lane evidence, absent degraded telemetry rows, and missing fail-open proof under forced telemetry write failure.
Output: A remediation plan that fixes author-cache live-write instability, tightens OPS75 preflight/evidence contracts, and captures a passing closure run tied to OPS75 check IDs.
- [x] **T04: 75-live-ops-verification-closure 04** `est:1 min`
  - Close the remaining Phase 75 verification gaps by capturing a fresh live OPS75 evidence bundle that proves mention-lane coverage and degraded exactly-once telemetry rows in the same deterministic matrix run.

Purpose: Plan 75-03 fixed tooling and preflight contracts, but closure is still blocked because sampled live identities did not include persisted mention-lane rows or degraded rows with `degradation_path != none`.
Output: Updated smoke and debug docs with fresh run identities plus verifier output showing all previously failing OPS75 checks now pass.
- [x] **T05: 75-live-ops-verification-closure 05** `est:2 min`
  - Close the identity-capture gaps that are blocking OPS75 by collecting one fresh, preflight-valid matrix for review and mention cache lanes plus degraded executions that truly emitted degraded telemetry rows.

Purpose: Current reruns fail because identities are selected from incomplete telemetry snapshots; this plan makes identity gating and evidence capture deterministic before any closure claim.
Output: Updated runbook and smoke evidence containing a validated same-run identity matrix ready for a release-blocking verifier run.
- [x] **T06: 75-live-ops-verification-closure 06** `est:2 min`
  - Produce the final Phase 75 closure evidence run where all OPS75 families pass together and verification status can move from `gaps_found` to `passed`.

Purpose: Phase 75 remains blocked until cache-lane and exactly-once degraded checks pass in one reproducible live run with strict check-ID proof.
Output: Updated smoke evidence and verification report showing complete OPS75 closure with explicit release-blocking discipline preserved.
- [x] **T07: 75-live-ops-verification-closure 07** `est:4min`
  - Fix OPS75 verifier scope mismatch and provide operator trigger procedure for remaining production evidence gaps.

Purpose: OPS75-CACHE-02 checks mention-lane rate_limit_events rows, but the mention handler (`src/handlers/mention.ts`) does not use Search API author classification and never calls `recordRateLimitEvent`. This is a verifier scope error, not a production data gap. Removing this invalid check and simplifying the matrix to review-only cache evidence unblocks closure. Additionally, the operator needs a documented procedure to trigger cache-hit and degraded review runs.

Output: Corrected verifier script and operator trigger runbook enabling fresh evidence capture.
- [x] **T08: 75-live-ops-verification-closure 08** `est:1min`
  - Update the stale smoke procedure document to match the corrected Phase 75 verifier CLI after plan 75-07 removed mention-lane support.

Purpose: The smoke doc still documents `--mention` flags, `OPS75-CACHE-02`, and 6-identity invocation that the verifier no longer accepts. Because the verifier uses `strict: true` argument parsing, an operator following the current doc would get `unexpected argument '--mention'` immediately. This is a blocker for operability.

Output: A corrected `docs/smoke/phase75-live-ops-verification-closure.md` that matches the review-only verifier CLI.

## Files Likely Touched

- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`
- `src/index.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `scripts/phase75-live-ops-verification-closure.ts`
- `scripts/phase75-live-ops-verification-closure.test.ts`
- `package.json`
- `docs/smoke/phase75-live-ops-verification-closure.md`
- `docs/runbooks/review-requested-debug.md`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `scripts/phase75-live-ops-verification-closure.ts`
- `docs/smoke/phase75-live-ops-verification-closure.md`
- `docs/runbooks/review-requested-debug.md`
- `docs/smoke/phase75-live-ops-verification-closure.md`
- `docs/runbooks/review-requested-debug.md`
- `docs/runbooks/review-requested-debug.md`
- `docs/smoke/phase75-live-ops-verification-closure.md`
- `docs/smoke/phase75-live-ops-verification-closure.md`
- `.planning/phases/75-live-ops-verification-closure/75-VERIFICATION.md`
- `scripts/phase75-live-ops-verification-closure.ts`
- `docs/runbooks/review-requested-debug.md`
- `docs/smoke/phase75-live-ops-verification-closure.md`
