---
id: T01
parent: S02
milestone: M046
key_files:
  - src/contributor/xbmc-fixture-snapshot.ts
  - src/contributor/xbmc-fixture-snapshot.test.ts
  - scripts/verify-m046-s01.ts
  - src/contributor/index.ts
  - .gsd/milestones/M046/slices/S02/tasks/T01-SUMMARY.md
key_decisions:
  - D079 — Centralize xbmc snapshot validation in a shared source module and make verify:m046:s01 consume it.
duration: 
verification_result: passed
completed_at: 2026-04-10T21:43:33.480Z
blocker_discovered: false
---

# T01: Added a shared xbmc snapshot loader and moved verify:m046:s01 onto it.

**Added a shared xbmc snapshot loader and moved verify:m046:s01 onto it.**

## What Happened

Wrote the new xbmc snapshot seam test-first, confirmed the missing-module red state, then implemented src/contributor/xbmc-fixture-snapshot.ts as the shared offline loader/validator/inspection module for the checked-in fixture snapshot. The helper now owns the snapshot shape, projects retained/excluded rows back through fixture-manifest validation to catch semantic drift such as duplicate contributor identities, preserves diagnostics and provenance inspection data for downstream evaluators, and exposes assert/load/inspect-style entrypoints. I refactored scripts/verify-m046-s01.ts to consume that helper instead of maintaining a private snapshot schema copy, kept its existing proof checks green, exported the new seam from src/contributor/index.ts, and recorded the downstream-facing architecture decision plus the semantic-validation gotcha in the GSD records.

## Verification

Focused loader/verifier tests passed, the slice proof command still reported a passing checked-in xbmc snapshot with retained=3 and excluded=6 plus ready/provenance/alias diagnostics, and a barrel-export smoke check confirmed S02 can import loadXbmcFixtureSnapshot from src/contributor/index.ts.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./scripts/verify-m046-s01.test.ts` | 0 | ✅ pass | 218ms |
| 2 | `bun run verify:m046:s01 -- --json` | 0 | ✅ pass | 163ms |
| 3 | `bun --eval "import { loadXbmcFixtureSnapshot } from './src/contributor/index.ts'; if (typeof loadXbmcFixtureSnapshot !== 'function') throw new Error('missing loadXbmcFixtureSnapshot export');"` | 0 | ✅ pass | 155ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/contributor/xbmc-fixture-snapshot.ts`
- `src/contributor/xbmc-fixture-snapshot.test.ts`
- `scripts/verify-m046-s01.ts`
- `src/contributor/index.ts`
- `.gsd/milestones/M046/slices/S02/tasks/T01-SUMMARY.md`
