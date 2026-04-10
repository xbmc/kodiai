---
id: T01
parent: S01
milestone: M046
key_files:
  - src/contributor/fixture-set.ts
  - src/contributor/fixture-set.test.ts
  - fixtures/contributor-calibration/xbmc-manifest.json
  - fixtures/contributor-calibration/xbmc-snapshot.json
  - src/contributor/xbmc-fixture-refresh.test.ts
  - scripts/verify-m046-s01.test.ts
  - src/contributor/index.ts
key_decisions:
  - Seed the initial xbmc truth set with one clear senior, one clear newcomer, and one ambiguous-middle retained contributor while keeping bot, alias-collision, and ambiguous-identity rows explicit in the exclusion list instead of guessing merges.
duration: 
verification_result: mixed
completed_at: 2026-04-10T20:18:53.697Z
blocker_discovered: false
---

# T01: Added the xbmc fixture contract, curated manifest, snapshot scaffold, and red follow-up tests for refresh/verify entrypoints.

**Added the xbmc fixture contract, curated manifest, snapshot scaffold, and red follow-up tests for refresh/verify entrypoints.**

## What Happened

Wrote the fixture contract test first, verified it failed because the module and fixture files were missing, then implemented a typed fixture manifest loader/validator in src/contributor/fixture-set.ts. Seeded fixtures/contributor-calibration/xbmc-manifest.json with explicit retained senior/newcomer/ambiguous-middle samples plus bot and identity-risk exclusions, and added fixtures/contributor-calibration/xbmc-snapshot.json as the deterministic scaffold for later refresh output. Also created the slice’s refresh/verifier test files in an intentionally red state while keeping tsc green by avoiding compile-time imports of missing next-task modules.

## Verification

Task-level verification passed: bun test ./src/contributor/fixture-set.test.ts and test -s fixtures/contributor-calibration/xbmc-manifest.json both succeeded, and bun run tsc --noEmit passed after keeping the future red tests runtime-only. Slice-level verification is intentionally partial at this stage: the combined bun test command fails only because src/contributor/xbmc-fixture-refresh.ts and scripts/verify-m046-s01.ts do not exist yet, and both bun run verify:m046:s01 variants fail because the package entrypoint has not been added yet.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/fixture-set.test.ts` | 0 | ✅ pass | 75ms |
| 2 | `test -s fixtures/contributor-calibration/xbmc-manifest.json` | 0 | ✅ pass | 16ms |
| 3 | `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts` | 1 | ❌ fail | 78ms |
| 4 | `bun run verify:m046:s01 -- --json` | 1 | ❌ fail | 16ms |
| 5 | `bun run verify:m046:s01 -- --refresh --json` | 1 | ❌ fail | 16ms |
| 6 | `bun run tsc --noEmit` | 0 | ✅ pass | 7537ms |

## Deviations

Added src/contributor/xbmc-fixture-refresh.test.ts and scripts/verify-m046-s01.test.ts during T01 so the first task of the slice leaves explicit red tests in place for the remaining refresh and verifier work.

## Known Issues

src/contributor/xbmc-fixture-refresh.ts, scripts/verify-m046-s01.ts, and the verify:m046:s01 package script are still unimplemented, so the slice-level refresh/verifier checks remain red until T02.

## Files Created/Modified

- `src/contributor/fixture-set.ts`
- `src/contributor/fixture-set.test.ts`
- `fixtures/contributor-calibration/xbmc-manifest.json`
- `fixtures/contributor-calibration/xbmc-snapshot.json`
- `src/contributor/xbmc-fixture-refresh.test.ts`
- `scripts/verify-m046-s01.test.ts`
- `src/contributor/index.ts`
