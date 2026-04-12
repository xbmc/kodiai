---
id: T03
parent: S01
milestone: M046
key_files:
  - scripts/verify-m046-s01.ts
  - scripts/verify-m046-s01.test.ts
  - src/contributor/xbmc-fixture-refresh.ts
  - fixtures/contributor-calibration/xbmc-snapshot.json
  - package.json
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Derive xbmc snapshot `generatedAt` from the latest provenance `observedAt` timestamp, with `curatedAt` fallback, instead of wall-clock time.
  - Emit one stable verifier report with explicit `check_ids`/`status_code` values across human and JSON modes so downstream slices can consume the same proof surface programmatically.
duration: 
verification_result: passed
completed_at: 2026-04-10T21:05:43.414Z
blocker_discovered: false
---

# T03: Shipped `verify:m046:s01`, refreshed the checked-in xbmc snapshot through that CLI, and made refresh timestamps deterministic.

**Shipped `verify:m046:s01`, refreshed the checked-in xbmc snapshot through that CLI, and made refresh timestamps deterministic.**

## What Happened

Replaced the placeholder verifier test with a real red-green spec, implemented `scripts/verify-m046-s01.ts` as the shipped refresh/verify proof harness, wired `verify:m046:s01` into `package.json`, and refreshed the checked-in xbmc snapshot through that final CLI path. The verifier now emits stable named checks for manifest validity, refresh execution, snapshot validity, curated sync, snapshot status, cohort coverage, provenance completeness, source availability, and alias diagnostics in both human-readable and JSON forms. While running the full slice verification suite, I found that `refreshXbmcFixtureSnapshot()` still defaulted `generatedAt` to wall-clock time, which caused unstable snapshot bytes; I fixed that root cause by deriving the timestamp deterministically from provenance evidence and then reran the refresh/verify flow to regenerate the checked-in snapshot.

## Verification

Verified the slice test bundle, both shipped verifier modes, and a clean typecheck. `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts` passed with 21/21 tests green. `bun run verify:m046:s01 -- --json` passed against the final checked-in snapshot. `bun run verify:m046:s01 -- --refresh --json` rebuilt `fixtures/contributor-calibration/xbmc-snapshot.json` through the shipped entrypoint and then re-verified it successfully. `bun run tsc --noEmit` exited 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts` | 0 | ✅ pass | 178ms |
| 2 | `bun run verify:m046:s01 -- --json` | 0 | ✅ pass | 112ms |
| 3 | `bun run verify:m046:s01 -- --refresh --json` | 0 | ✅ pass | 10463ms |
| 4 | `bun run tsc --noEmit` | 0 | ✅ pass | 7619ms |

## Deviations

Full slice verification exposed a pre-existing nondeterministic `generatedAt` bug in `src/contributor/xbmc-fixture-refresh.ts`; I fixed it because the slice contract requires stable checked-in refresh output.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m046-s01.ts`
- `scripts/verify-m046-s01.test.ts`
- `src/contributor/xbmc-fixture-refresh.ts`
- `fixtures/contributor-calibration/xbmc-snapshot.json`
- `package.json`
- `.gsd/KNOWLEDGE.md`
