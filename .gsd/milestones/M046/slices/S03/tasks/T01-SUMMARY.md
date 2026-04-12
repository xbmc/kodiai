---
id: T01
parent: S03
milestone: M046
key_files:
  - src/contributor/calibration-change-contract.ts
  - src/contributor/calibration-change-contract.test.ts
  - src/contributor/index.ts
  - .gsd/KNOWLEDGE.md
  - .gsd/milestones/M046/slices/S03/tasks/T01-SUMMARY.md
key_decisions:
  - D083 — Represent the change contract as a pure verdict-filtered inventory with explicit malformed-input and contradiction validation.
duration: 
verification_result: mixed
completed_at: 2026-04-10T22:54:18.786Z
blocker_discovered: false
---

# T01: Added the reusable M047 calibration change-contract helper and pinned the current replace inventory with focused tests.

**Added the reusable M047 calibration change-contract helper and pinned the current replace inventory with focused tests.**

## What Happened

Added a pure `buildCalibrationChangeContract` helper that converts the S02 calibration recommendation into a deterministic M047 keep/change/replace contract with stable mechanism ids, evidence strings, and impacted-surface identifiers. The emitted replace contract preserves the M045 contributor-experience vocabulary in a keep bucket, classifies the current stored-tier review and Slack consumer surfaces as change targets, and isolates the live `pr_authored`-only incremental scoring path as the explicit replace target. Added `CalibrationChangeContractError` with named codes for missing verdict/rationale, unsupported verdicts, missing impacted surfaces, duplicate mechanisms, and contradictory bucket assignments. Wrote focused regression tests that pin the current replace inventory, validate the referenced review/slack/experience source markers, and prove the negative paths. Exported the helper from `src/contributor/index.ts` and recorded the Bun unmatched-filter verification gotcha in `.gsd/KNOWLEDGE.md`.

## Verification

Task-level verification passed with `bun test ./src/contributor/calibration-change-contract.test.ts` and `bun run tsc --noEmit`. Intermediate slice-level verification was also exercised: `bun test ./scripts/verify-m046.test.ts`, `bun run verify:m046`, `bun run verify:m046 -- --json`, and `bun run verify:m046:s01 -- --json && bun run verify:m046:s02 -- --json && bun run verify:m046 -- --json` all fail as expected because the integrated T02 proof surface does not exist yet. The broader test bundle command still exited 0 because Bun ignored the unmatched `./scripts/verify-m046.test.ts` filter while running the four existing files, so the missing integrated test was confirmed separately with the direct single-file command.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/calibration-change-contract.test.ts` | 0 | ✅ pass | 78ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 7752ms |
| 3 | `bun test ./scripts/verify-m046.test.ts` | 1 | ❌ fail | 7ms |
| 4 | `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts ./scripts/verify-m046.test.ts` | 0 | ✅ pass | 215ms |
| 5 | `bun run verify:m046` | 1 | ❌ fail | 2ms |
| 6 | `bun run verify:m046 -- --json` | 1 | ❌ fail | 3ms |
| 7 | `bun run verify:m046:s01 -- --json && bun run verify:m046:s02 -- --json && bun run verify:m046 -- --json` | 1 | ❌ fail | 257ms |

## Deviations

None.

## Known Issues

Integrated `verify:m046` artifacts (`scripts/verify-m046.test.ts` and the `verify:m046` package script) do not exist yet, so slice-level end-to-end verification remains partial until T02 lands.

## Files Created/Modified

- `src/contributor/calibration-change-contract.ts`
- `src/contributor/calibration-change-contract.test.ts`
- `src/contributor/index.ts`
- `.gsd/KNOWLEDGE.md`
- `.gsd/milestones/M046/slices/S03/tasks/T01-SUMMARY.md`
