---
id: T02
parent: S02
milestone: M046
key_files:
  - src/contributor/calibration-evaluator.ts
  - src/contributor/calibration-evaluator.test.ts
  - src/contributor/expertise-scorer.ts
  - src/contributor/xbmc-fixture-snapshot.ts
  - src/contributor/index.ts
  - .gsd/KNOWLEDGE.md
  - .gsd/milestones/M046/slices/S02/tasks/T02-SUMMARY.md
key_decisions:
  - D080 — Model current live calibration as linked-but-unscored newcomer guidance unless changed-file replay is available, and approximate intended full-signal differentiation from checked-in commit counts plus PR/review provenance using shipped weights.
duration: 
verification_result: mixed
completed_at: 2026-04-10T21:58:53.339Z
blocker_discovered: false
---

# T02: Added a deterministic calibration evaluator for live-vs-intended contributor-model paths.

**Added a deterministic calibration evaluator for live-vs-intended contributor-model paths.**

## What Happened

Added a pure calibration evaluator over the validated xbmc snapshot, with test-first coverage for cohort truth, malformed retained provenance, malformed commit-count relationships, tied/small-cohort instability, freshness findings, and live-vs-intended contract projection. The evaluator now models the current live path honestly as linked-but-unscored newcomer guidance when changed-file replay is unavailable, models the intended full-signal path from checked-in commit counts plus PR/review provenance using the shipped weights and percentile tiering, preserves excluded rows as explicit control diagnostics, emits a keep/retune/replace recommendation, and exports the seam for the upcoming verifier. While running broader verification I also fixed an existing provenance-source typing hole in the shared snapshot loader so TypeScript typecheck stays green.

## Verification

Task-specific evaluator tests passed, broader contributor snapshot and S01 verifier suites stayed green, `bun run verify:m046:s01 -- --json` passed against the checked-in snapshot, and `bun run tsc --noEmit` passed after tightening snapshot provenance source typing. The only failing slice-level check is the still-missing `verify:m046:s02` entrypoint, which belongs to T03 rather than this task.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/calibration-evaluator.test.ts` | 0 | ✅ pass | 78ms |
| 2 | `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts` | 0 | ✅ pass | 157ms |
| 3 | `bun run verify:m046:s01 -- --json` | 0 | ✅ pass | 93ms |
| 4 | `bun run tsc --noEmit` | 0 | ✅ pass | 7638ms |
| 5 | `bun run verify:m046:s02 -- --json` | 1 | ❌ fail | 4ms |

## Deviations

None.

## Known Issues

`bun run verify:m046:s02 -- --json` still fails because the T03 verifier script/package entrypoint has not been implemented yet.

## Files Created/Modified

- `src/contributor/calibration-evaluator.ts`
- `src/contributor/calibration-evaluator.test.ts`
- `src/contributor/expertise-scorer.ts`
- `src/contributor/xbmc-fixture-snapshot.ts`
- `src/contributor/index.ts`
- `.gsd/KNOWLEDGE.md`
- `.gsd/milestones/M046/slices/S02/tasks/T02-SUMMARY.md`
