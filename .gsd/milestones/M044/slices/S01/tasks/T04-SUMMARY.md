---
id: T04
parent: S01
milestone: M044
key_files:
  - scripts/verify-m044-s01.ts
  - scripts/verify-m044-s01.test.ts
  - package.json
  - src/handlers/review-idempotency.ts
  - src/handlers/review-idempotency.test.ts
  - src/review-audit/recent-review-sample.ts
  - src/review-audit/recent-review-sample.test.ts
  - src/review-audit/evidence-correlation.ts
  - src/review-audit/evidence-correlation.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - The S01 verifier returns success when live GitHub sampling succeeds, even if DB-backed evidence is unavailable, because `indeterminate` is a truthful provisional outcome for this slice.
  - DB-backed evidence loaders fail open to `unavailable` instead of crashing the command; the verifier must preserve the GitHub sample and surface the missing proof explicitly.
duration: 
verification_result: mixed
completed_at: 2026-04-09T07:57:55.217Z
blocker_discovered: false
---

# T04: Shipped the `verify:m044:s01` command and ran the first live recent-review audit against xbmc/xbmc.

**Shipped the `verify:m044:s01` command and ran the first live recent-review audit against xbmc/xbmc.**

## What Happened

Implemented the S01 verifier end to end. `scripts/verify-m044-s01.ts` now follows the repo's `verify:*` pattern: it parses CLI args, performs truthful preflight, lists recent PRs from GitHub, reuses the collector/selector and evidence correlation modules, and prints either human-readable or JSON output. I wrote the script tests first, then added the package script `verify:m044:s01`, then ran the full S01 test suite and the live verifier command. The first live run failed on a PostgreSQL connect timeout, which revealed that DB-backed evidence needed to fail open; I added another red-green pass so the command now marks `databaseAccess=unavailable` and still returns the real GitHub sample. The final live run succeeded against `xbmc/xbmc`, scanning 96 recent PRs, collecting 67 Kodiai marker-backed artifacts, and selecting a deterministic sample of 12 PRs (10 automatic, 2 explicit) with truthful `indeterminate` verdicts where internal proof was unavailable.

## Verification

The full S01 test suite passed via `bun test ./src/handlers/review-idempotency.test.ts ./src/review-audit/recent-review-sample.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m044-s01.test.ts` (27 passing tests, 0 failures). The live command `bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json` then completed successfully with `status_code: m044_s01_ok`, `githubAccess: available`, `databaseAccess: unavailable`, `scannedPullRequests: 96`, `collectedArtifacts: 67`, and a final sample of 12 recent PRs.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/review-idempotency.test.ts ./src/review-audit/recent-review-sample.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m044-s01.test.ts -> 27 pass, 0 fail` | -1 | unknown (coerced from string) | 0ms |
| 2 | `bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json -> status_code=m044_s01_ok, scannedPullRequests=96, collectedArtifacts=67, selected=12` | -1 | unknown (coerced from string) | 0ms |

## Deviations

The first live verifier run exposed a real environment failure mode: `DATABASE_URL` was present but the DB was unreachable (`CONNECT_TIMEOUT`). I expanded the verifier to degrade DB-backed evidence to `databaseAccess=unavailable` and continue the GitHub audit instead of aborting the whole command. This stayed within T04 because truthful preflight/fail-open reporting is part of the verifier contract.

## Known Issues

The current environment could reach GitHub but not the configured PostgreSQL instance, so all automatic-lane cases in the live S01 run are truthfully `indeterminate` and explicit-lane cases remain `indeterminate` until publish-resolution evidence is wired in a later slice.

## Files Created/Modified

- `scripts/verify-m044-s01.ts`
- `scripts/verify-m044-s01.test.ts`
- `package.json`
- `src/handlers/review-idempotency.ts`
- `src/handlers/review-idempotency.test.ts`
- `src/review-audit/recent-review-sample.ts`
- `src/review-audit/recent-review-sample.test.ts`
- `src/review-audit/evidence-correlation.ts`
- `src/review-audit/evidence-correlation.test.ts`
- `.gsd/KNOWLEDGE.md`
