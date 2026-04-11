---
id: T01
parent: S01
milestone: M047
key_files:
  - src/db/migrations/037-contributor-profile-trust.sql
  - src/db/migrations/037-contributor-profile-trust.down.sql
  - src/contributor/profile-trust.ts
  - src/contributor/profile-trust.test.ts
  - src/contributor/profile-store.ts
  - src/contributor/profile-store.test.ts
  - src/contributor/types.ts
  - src/contributor/index.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Persist one nullable versioned `trust_marker` (`m047-calibrated-v1`) on `contributor_profiles` and derive trust from that marker plus `lastScoredAt` instead of inferring trust from raw `overall_tier`.
  - Fail fast on store reads when the migrated `trust_marker` column is absent, but classify null, stale, and unsupported marker values as explicit untrusted states through one shared helper.
duration: 
verification_result: mixed
completed_at: 2026-04-11T00:31:52.061Z
blocker_discovered: false
---

# T01: Added persisted contributor-profile trust markers and trust-state classification so linked-unscored or legacy rows stay untrusted until a fresh scored update stamps the M047 marker.

**Added persisted contributor-profile trust markers and trust-state classification so linked-unscored or legacy rows stay untrusted until a fresh scored update stamps the M047 marker.**

## What Happened

Added migration 037 to persist a nullable versioned `trust_marker` on `contributor_profiles`, then introduced `src/contributor/profile-trust.ts` as the pure persisted-row trust boundary for `linked-unscored`, `legacy`, `calibrated`, `stale`, and `malformed` states. `createContributorProfileStore(...)` now maps the new column, fails fast when the migrated column is missing, and stamps `m047-calibrated-v1` whenever `updateTier(...)` writes a fresh score so newly linked placeholder rows remain visibly untrusted while freshly scored rows are distinguishable from legacy data. Added focused helper tests plus DB-backed store tests that run migrations, verify the new column exists, prove link-created newcomer rows stay untrusted, and prove `updateTier(...)` stamps the current marker. The store-test harness now uses `TEST_DATABASE_URL` or the localhost default instead of the repo’s remote `DATABASE_URL`, avoiding verification hangs against the unreachable Azure database.

## Verification

`bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts` passed (19/19). The broader slice-level `bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts ./scripts/verify-m047-s01.test.ts` command also exited 0, but explicit path checks confirmed Bun ignored the still-missing future-file filters (`src/contributor/review-author-resolution.test.ts`, `scripts/verify-m047-s01.test.ts`). `bun run verify:m045:s01` passed. `bun run verify:m047:s01` failed because the package script is not present yet, which is expected until T03 ships the verifier. `bun run tsc --noEmit` passed.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts` | 0 | ✅ pass | 215ms |
| 2 | `bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts ./scripts/verify-m047-s01.test.ts` | 0 | ✅ pass | 3637ms |
| 3 | `printf 'review-author-resolution.test.ts=%s\n' "$(test -f src/contributor/review-author-resolution.test.ts && echo present || echo missing)"; printf 'verify-m047-s01.test.ts=%s\n' "$(test -f scripts/verify-m047-s01.test.ts && echo present || echo missing)"; jq -r '.scripts["verify:m047:s01"] // "missing"' package.json` | 0 | ✅ pass | 27ms |
| 4 | `bun run verify:m045:s01` | 0 | ✅ pass | 60ms |
| 5 | `bun run verify:m047:s01` | 1 | ❌ fail | 27ms |
| 6 | `bun run tsc --noEmit` | 0 | ✅ pass | 7953ms |

## Deviations

None.

## Known Issues

The downstream slice proof surfaces are intentionally not present yet: `src/contributor/review-author-resolution.test.ts`, `scripts/verify-m047-s01.test.ts`, and package script `verify:m047:s01` remain for T02/T03. Because Bun can ignore missing file filters when other test paths match, the slice-level multi-path `bun test` bundle is not by itself proof that those future files exist.

## Files Created/Modified

- `src/db/migrations/037-contributor-profile-trust.sql`
- `src/db/migrations/037-contributor-profile-trust.down.sql`
- `src/contributor/profile-trust.ts`
- `src/contributor/profile-trust.test.ts`
- `src/contributor/profile-store.ts`
- `src/contributor/profile-store.test.ts`
- `src/contributor/types.ts`
- `src/contributor/index.ts`
- `.gsd/KNOWLEDGE.md`
