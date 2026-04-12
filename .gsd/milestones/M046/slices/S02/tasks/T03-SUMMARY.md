---
id: T03
parent: S02
milestone: M046
key_files:
  - scripts/verify-m046-s02.ts
  - scripts/verify-m046-s02.test.ts
  - package.json
  - .gsd/milestones/M046/slices/S02/tasks/T03-SUMMARY.md
key_decisions:
  - D081 — Gate `verify:m046:s02` on the S01 verifier, compare retained/excluded truth against the checked-in manifest, and keep degraded snapshot inspection visible while skipping misleading calibration verdicts.
duration: 
verification_result: passed
completed_at: 2026-04-10T22:10:25.895Z
blocker_discovered: false
---

# T03: Shipped `verify:m046:s02` with stable per-contributor calibration verdict reporting.

**Shipped `verify:m046:s02` with stable per-contributor calibration verdict reporting.**

## What Happened

Wrote the S02 verifier test-first, confirmed the initial red state from the missing script and package entry, then implemented `scripts/verify-m046-s02.ts` as the operator-facing calibration proof harness. The verifier now runs the S01 prerequisite proof, inspects the checked-in xbmc snapshot, compares retained and excluded contributor truth against the checked-in manifest, runs the calibration evaluator only when prerequisites pass, and emits both human-readable and `--json` output from one normalized report object. The shipped report exposes retained contributor fixture evidence, live vs intended contract projections, percentile and tie-instability diagnostics, freshness and linked-but-unscored findings, excluded control rows, and the final keep/retune/replace recommendation. I also added `scripts/verify-m046-s02.test.ts` to pin the report shape, human/JSON alignment, package wiring, prerequisite failure handling, evaluator drift handling, and missing recommendation behavior, and added the canonical `verify:m046:s02` package script.

## Verification

Ran the full slice-level contributor verification suite, re-ran `bun run verify:m046:s01 -- --json`, exercised `bun run verify:m046:s02 -- --json` and `bun run verify:m046:s02` against the checked-in xbmc snapshot, and confirmed `bun run tsc --noEmit` still passes. The new verifier reports stable prerequisite/snapshot/truth/recommendation check IDs, exposes retained and excluded diagnostics, and returns a `replace` recommendation for the current live incremental path versus the intended full-signal path.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts` | 0 | ✅ pass | 162ms |
| 2 | `bun run verify:m046:s01 -- --json` | 0 | ✅ pass | 96ms |
| 3 | `bun run verify:m046:s02 -- --json` | 0 | ✅ pass | 102ms |
| 4 | `bun run verify:m046:s02` | 0 | ✅ pass | 116ms |
| 5 | `bun run tsc --noEmit` | 0 | ✅ pass | 7624ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m046-s02.ts`
- `scripts/verify-m046-s02.test.ts`
- `package.json`
- `.gsd/milestones/M046/slices/S02/tasks/T03-SUMMARY.md`
