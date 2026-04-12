---
estimated_steps: 13
estimated_files: 7
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T01: Persist contributor-profile trust metadata and classify stored profile states

**Slice:** S01 — Truthful contributor resolution on GitHub review
**Milestone:** M047

## Description

Persist the minimum metadata needed to tell a newly linked or legacy contributor profile row apart from a trustworthy M047-calibrated row. This task gives later review logic one narrow trust primitive instead of re-inferring certainty from `overall_tier='newcomer'`.

## Steps

1. Add a contributor-profile trust helper plus migration-backed metadata that can distinguish linked-unscored, legacy, calibrated, stale, and malformed stored rows.
2. Teach `createContributorProfileStore(...)` to read the new metadata and stamp the current M047 calibration marker whenever `updateTier(...)` persists a fresh scored tier.
3. Cover the new states with focused unit tests and DB-backed profile-store tests, including the default newcomer row created by identity linking.
4. Keep the helper small and reusable so later slices can share the same persisted trust boundary.

## Must-Haves

- [ ] Stored contributor rows can distinguish linked-unscored, legacy, calibrated, stale, and malformed trust states without relying on raw `overall_tier`.
- [ ] Fresh score persistence stamps the current M047 calibration marker instead of leaving scored rows indistinguishable from legacy data.
- [ ] Tests prove newly linked rows stay untrusted until a scored update lands.

## Inputs

- `src/db/migrations/011-contributor-profiles.sql`
- `src/contributor/types.ts`
- `src/contributor/profile-store.ts`
- `src/contributor/profile-store.test.ts`
- `src/contributor/expertise-scorer.ts`

## Expected Output

- `src/db/migrations/037-contributor-profile-trust.sql`
- `src/db/migrations/037-contributor-profile-trust.down.sql`
- `src/contributor/types.ts`
- `src/contributor/profile-store.ts`
- `src/contributor/profile-store.test.ts`
- `src/contributor/profile-trust.ts`
- `src/contributor/profile-trust.test.ts`

## Verification

bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/db/migrations/037-contributor-profile-trust.sql` / `contributor_profiles` | Fail fast in migration and store tests instead of silently treating missing trust metadata as trustworthy. | N/A — local migration only. | Default null/unknown metadata to an untrusted legacy state; never infer `profile-backed` from malformed persisted rows. |
| `src/contributor/profile-store.ts` | Keep identity-link and score-update flows working while mapping new trust metadata through one store seam. | N/A — local DB/store only. | Reject unsupported trust markers in tests and map them to explicit untrusted states rather than passing raw values downstream. |

## Load Profile

- **Shared resources**: one `contributor_profiles` table plus the existing profile-store update path.
- **Per-operation cost**: one migration, one profile-row read/write path, and small pure trust-state checks.
- **10x breakpoint**: schema drift and stale rows hurt correctness before raw compute cost does, so the helper must stay small and derived from persisted row fields only.

## Negative Tests

- **Malformed inputs**: missing calibration marker, null `last_scored_at`, unsupported trust marker, and malformed `overall_tier` values.
- **Error paths**: migration absent, row missing new columns, and score updates that forget to stamp the current calibration marker.
- **Boundary conditions**: freshly linked newcomer row, legacy scored row, explicitly stale scored row, and a genuinely calibrated row with a zero/newcomer tier.
