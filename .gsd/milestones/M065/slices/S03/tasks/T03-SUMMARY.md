---
id: T03
parent: S03
milestone: M065
key_files:
  - scripts/verify-m065.ts
  - scripts/verify-m065.test.ts
key_decisions:
  - Drive top-level fresh-regression status synthesis from the raw S03 payload while keeping `nested_reports.s03` separately validated for preserved authoritative storage.
  - Treat malformed S03 output as a nested contract failure, but continue to let earlier prerequisite and S02 failures win first-failing-check selection.
duration: 
verification_result: mixed
completed_at: 2026-04-24T09:37:51.549Z
blocker_discovered: false
---

# T03: Hardened verify:m065 so malformed nested S03 output fails mechanically while preserving S02-first drill-down ordering.

**Hardened verify:m065 so malformed nested S03 output fails mechanically while preserving S02-first drill-down ordering.**

## What Happened

I started from the existing T02 composition and verified the current behavior against the T03 contract before editing. The focused tests showed the real gap: `evaluateM065()` validated the S03 payload for `nested_reports.s03` and then reused that sanitized value when synthesizing the top-level fresh-regression check, which collapsed malformed S03 output into a misleading pending state. I added test coverage first in `scripts/verify-m065.test.ts` for three cases the plan called out: malformed raw S03 payloads must fail as nested-contract errors, a passing S03 report must not mask an earlier S02 failure, and the fresh-regression slot must still satisfy cleanly when S03 is valid. After confirming the malformed-S03 case failed red, I updated `scripts/verify-m065.ts` so the preserved nested report remains typed/null-safe for `nested_reports.s03`, but the top-level `M065-FRESH-REGRESSION-PROOF` check and `rollout_obligations.freshRegressionProof` are derived from the raw S03 payload. That keeps absence (`null`/not supplied) distinct from malformed structure, marks malformed S03 responses as `nested_report_malformed` with the S03 drill-down command, and preserves first-failing-check selection so earlier prerequisite/S02 failures still win when present. I then reran the focused tests plus the real `verify:m065` CLI to confirm the fresh-regression path is satisfied from nested S03 evidence in the live report while the existing S02 blocker still localizes mechanically to `nested_reports.s02`.

## Verification

Fresh verification ran after the last code change. `bun test scripts/verify-m065.test.ts` passed 13/13, including the new malformed-S03 and failure-order assertions. `bun test scripts/verify-m065-s03.test.ts` stayed green at 5/5, confirming the nested verifier contract was not regressed. `bun run verify:m065 -- --json` still exits 1 in this environment, but for the expected pre-existing S02 reason (`M065-LIVE-LARGE-PR-PROOF:nested_report_failed`); the JSON report now still shows `M065-FRESH-REGRESSION-PROOF` satisfied from `nested_reports.s03`, which proves S03 composition and first-failing-check localization remain mechanical.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test scripts/verify-m065.test.ts` | 0 | ✅ pass | 114ms |
| 2 | `bun test scripts/verify-m065-s03.test.ts` | 0 | ✅ pass | 115ms |
| 3 | `bun run verify:m065 -- --json` | 1 | ❌ fail | 14617ms |

## Deviations

None.

## Known Issues

The live `bun run verify:m065 -- --json` command remains red because the separate S02 representative live large-PR proof cannot currently obtain runtime/GitHub/operator evidence in this environment (`m048_s01_no_matching_phase_timing`, `m049_s02_github_unavailable`, and missing canonical operator row). This task intentionally preserved that earlier blocker instead of masking it.

## Files Created/Modified

- `scripts/verify-m065.ts`
- `scripts/verify-m065.test.ts`
