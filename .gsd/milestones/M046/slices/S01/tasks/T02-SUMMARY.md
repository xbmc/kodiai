---
id: T02
parent: S01
milestone: M046
key_files:
  - src/contributor/xbmc-fixture-refresh.ts
  - src/contributor/xbmc-fixture-refresh.test.ts
  - src/auth/github-app.ts
  - src/contributor/index.ts
  - fixtures/contributor-calibration/xbmc-snapshot.json
key_decisions:
  - Bound GitHub evidence collection with explicit timeout/degrade behavior so Bun-loaded GitHub App credentials cannot make the refresh hang indefinitely.
  - Ignore malformed local git shortlog rows unless the entire shortlog becomes unusable, so unrelated `<>` rows do not degrade a valid curated snapshot.
duration: 
verification_result: mixed
completed_at: 2026-04-10T20:48:20.846Z
blocker_discovered: false
---

# T02: Built the xbmc fixture refresh module and generated the first live checked-in contributor snapshot.

**Built the xbmc fixture refresh module and generated the first live checked-in contributor snapshot.**

## What Happened

Implemented `src/contributor/xbmc-fixture-refresh.ts` to load the curated xbmc manifest, validate retained GitHub identities, detect unauthorized alias collisions, collect GitHub commit/PR/review evidence, enrich from `tmp/xbmc` shortlog data, and write a sorted checked-in snapshot with explicit provenance records and source-availability diagnostics. Replaced the refresh red scaffold with regression coverage for the happy path plus alias collisions, missing GitHub access, missing local workspace, GitHub timeout handling, missing retained usernames, and unsupported evidence sources. Extended `src/auth/github-app.ts` with optional request timeout support so Bun auto-loading GitHub App credentials from `.env` cannot make the live refresh hang indefinitely. Regenerated `fixtures/contributor-calibration/xbmc-snapshot.json`; the final live run reported `snapshot-refreshed` with 3 retained and 6 excluded contributors and no named failures.

## Verification

Task-level verification passed with `bun test ./src/contributor/xbmc-fixture-refresh.test.ts`, `test -s fixtures/contributor-calibration/xbmc-snapshot.json`, a live `refreshXbmcFixtureSnapshot()` invocation, and `bun run tsc --noEmit`. Slice-level verification is intentionally partial at T02: the combined slice test command fails only because `scripts/verify-m046-s01.ts` is not implemented yet, and both `bun run verify:m046:s01` variants fail because T03 has not added the CLI/package script.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/xbmc-fixture-refresh.test.ts` | 0 | ✅ pass | 213ms |
| 2 | `test -s fixtures/contributor-calibration/xbmc-snapshot.json` | 0 | ✅ pass | 37ms |
| 3 | `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts` | 1 | ❌ fail | 221ms |
| 4 | `bun run verify:m046:s01 -- --json` | 1 | ❌ fail | 38ms |
| 5 | `bun run verify:m046:s01 -- --refresh --json` | 1 | ❌ fail | 34ms |
| 6 | `bun run tsc --noEmit` | 0 | ✅ pass | 7628ms |
| 7 | `bun -e 'const { refreshXbmcFixtureSnapshot } = await import("./src/contributor/xbmc-fixture-refresh.ts"); const result = await refreshXbmcFixtureSnapshot(); console.log(JSON.stringify({ statusCode: result.statusCode, retainedCount: result.retainedCount, excludedCount: result.excludedCount, failureCodes: [...new Set(result.failures.map((failure) => failure.code))] }, null, 2));'` | 0 | ✅ pass | 9984ms |

## Deviations

Added bounded GitHub timeout handling in `src/auth/github-app.ts` during T02 because the first live refresh attempt hung once Bun auto-loaded GitHub App credentials from `.env`; the task contract required bounded timeout behavior, so the shared auth seam needed a minimal extension.

## Known Issues

`generatedAt` in the live snapshot still uses wall-clock time when the caller does not override it, so repeated live refreshes can create non-semantic snapshot drift even when the retained/excluded evidence set is unchanged. T03 should either make that field deterministic or explicitly ignore it in drift verification before the CLI verifier becomes authoritative.

## Files Created/Modified

- `src/contributor/xbmc-fixture-refresh.ts`
- `src/contributor/xbmc-fixture-refresh.test.ts`
- `src/auth/github-app.ts`
- `src/contributor/index.ts`
- `fixtures/contributor-calibration/xbmc-snapshot.json`
