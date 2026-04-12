---
id: T02
parent: S03
milestone: M046
key_files:
  - scripts/verify-m046.ts
  - scripts/verify-m046.test.ts
  - package.json
  - .gsd/DECISIONS.md
  - .gsd/milestones/M046/slices/S03/tasks/T02-SUMMARY.md
key_decisions:
  - D084 — Separate top-level proof-surface success from the keep/retune/replace recommendation so the truthful `replace` outcome exits 0 while malformed composition and contradictory contract state still fail non-zero.
duration: 
verification_result: passed
completed_at: 2026-04-10T23:08:57.761Z
blocker_discovered: false
---

# T02: Shipped the integrated `verify:m046` proof harness with a truthful `replace` verdict and structured M047 change contract.

**Shipped the integrated `verify:m046` proof harness with a truthful `replace` verdict and structured M047 change contract.**

## What Happened

Added `scripts/verify-m046.ts` as the integrated milestone-closeout proof harness for S03. The new evaluator runs S01 once, injects that exact cached report into S02 through the existing `_evaluateS01` seam, preserves both nested reports intact, derives a dedicated top-level verdict block, derives `m047ChangeContract` from the T01 helper, and validates the integrated surface with explicit top-level check IDs and named status codes. Added `scripts/verify-m046.test.ts` to pin the composition contract, truthful `replace` exit semantics, malformed nested-report handling, retained/excluded count drift detection, missing recommendation handling, contradictory contract handling, human/JSON alignment, and canonical script wiring. Added the `verify:m046` package script and recorded D084 so downstream work knows the integrated verifier treats `replace` as a truthful outcome while reserving non-zero exits for broken proof surfaces or contradictory contract state.

## Verification

Passed the focused integrated verifier regression test, the broader slice regression bundle across xbmc fixture snapshot + calibration + S01/S02/integrated verifier tests, the shipped `verify:m046` command in human and JSON modes, the nested `verify:m046:s01`/`verify:m046:s02`/`verify:m046` JSON chain, and `bun run tsc --noEmit`.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m046.test.ts` | 0 | ✅ pass | 137ms |
| 2 | `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts ./scripts/verify-m046.test.ts` | 0 | ✅ pass | 195ms |
| 3 | `bun run verify:m046` | 0 | ✅ pass | 109ms |
| 4 | `bun run verify:m046 -- --json` | 0 | ✅ pass | 102ms |
| 5 | `bun run verify:m046:s01 -- --json && bun run verify:m046:s02 -- --json && bun run verify:m046 -- --json` | 0 | ✅ pass | 311ms |
| 6 | `bun run tsc --noEmit` | 0 | ✅ pass | 8630ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m046.ts`
- `scripts/verify-m046.test.ts`
- `package.json`
- `.gsd/DECISIONS.md`
- `.gsd/milestones/M046/slices/S03/tasks/T02-SUMMARY.md`
