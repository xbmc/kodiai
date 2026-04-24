---
id: T02
parent: S03
milestone: M065
key_files:
  - scripts/verify-m065-s03.ts
  - scripts/verify-m065-s03.test.ts
  - scripts/verify-m065.ts
  - scripts/verify-m065.test.ts
  - docs/runbooks/m065-rollout-proof.md
key_decisions:
  - Wrapped `evaluateRegressionGateChecks(...)` directly and preserved its raw payload under `nested_reports.regression_gate` instead of parsing rendered text.
  - Projected `M065-FRESH-REGRESSION-PROOF` from authoritative `nested_reports.s03` data in the top-level M065 verifier so fresh-regression status is machine-checkable and independently drillable from the S02 live-proof path.
duration: 
verification_result: mixed
completed_at: 2026-04-24T09:34:05.166Z
blocker_discovered: false
---

# T02: Implemented the M065 S03 fresh-regression wrapper, machine-checkable rollout runbook, and top-level M065 composition for nested S03 proof.

**Implemented the M065 S03 fresh-regression wrapper, machine-checkable rollout runbook, and top-level M065 composition for nested S03 proof.**

## What Happened

I extended the S03 verifier from the T01 scaffold into a real wrapper around `evaluateRegressionGateChecks(...)` in `scripts/verify-m065-s03.ts` so it now preserves the authoritative regression-gate payload under `nested_reports.regression_gate`, distinguishes malformed-vs-red gate outcomes, validates the dedicated M065 rollout runbook and its referenced `bun run ...` commands against tracked package/file wiring, and exposes stable drill-down/report-key surfaces. I expanded `scripts/verify-m065-s03.test.ts` first to cover passing regression proof, failing wrapped suite ids, malformed nested output, missing runbook/package drift, and unsupported rerun wording, then implemented only enough code to satisfy those cases. I also updated `scripts/verify-m065.ts` and `scripts/verify-m065.test.ts` so the top-level M065 report now composes `verify:m065:s03`, preserves it under `nested_reports.s03`, projects `M065-FRESH-REGRESSION-PROOF` from the nested S03 contract instead of a placeholder, and localizes fresh-regression blockers to the S03 nested report while leaving the existing S02 live-proof path authoritative for the separate large-PR obligation. Finally, I added `docs/runbooks/m065-rollout-proof.md` with the supported explicit `@kodiai review` rerun rule, `deliveryId -> reviewOutputKey` capture order, the required top-level/nested verifier commands, and a report-key-first drill-down map so operators can recover from failing proof without log archaeology.

## Verification

Fresh verification ran after the last code change. `bun test scripts/verify-m065-s03.test.ts` passed (5/5). `bun run verify:m065:s03 -- --json` exited 0 and reported `m065_s03_ok`, with `fresh_regression_ok`, `runbook_present`, `rerun_commands_resolved`, and `package_wiring_ok`, plus the wrapped authoritative `M061-REG-*` payload under `nested_reports.regression_gate`. For slice-level verification, `bun run verify:m065 -- --json` now exposes `nested_reports.s03` and marks `M065-FRESH-REGRESSION-PROOF` as satisfied from S03, but the command still exits 1 in this environment because the separate S02 live large-PR proof remains red (`M065-LIVE-LARGE-PR-PROOF` / `m065_s02_nested_verifier_failed`) due missing live evidence and GitHub 403s. That top-level failure is expected current repo state, not a regression in this task, and it confirms the new fresh-regression wiring is observable without masking the existing S02 blocker.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test scripts/verify-m065-s03.test.ts` | 0 | ✅ pass | 117ms |
| 2 | `bun run verify:m065:s03 -- --json` | 0 | ✅ pass | 13213ms |
| 3 | `bun run verify:m065 -- --json` | 1 | ❌ fail | 15366ms |

## Deviations

I also updated `scripts/verify-m065.ts` and `scripts/verify-m065.test.ts` even though the task plan centered on S03, because the slice demo and verification bar require the final M065 surface to consume `nested_reports.s03` instead of keeping fresh regression proof as a placeholder.

## Known Issues

`bun run verify:m065 -- --json` still fails in the current environment because `verify:m065:s02` cannot obtain the representative live large-PR proof (`m048_s01_no_matching_phase_timing`, `m049_s02_github_unavailable`, and missing canonical operator row). S03 is green; milestone closeout remains blocked on the separate S02 live-proof obligation.

## Files Created/Modified

- `scripts/verify-m065-s03.ts`
- `scripts/verify-m065-s03.test.ts`
- `scripts/verify-m065.ts`
- `scripts/verify-m065.test.ts`
- `docs/runbooks/m065-rollout-proof.md`
