# S01: Truthful contributor resolution on GitHub review

**Goal:** Make GitHub review-time contributor resolution truthful by distinguishing trustworthy calibrated contributor-profile rows from linked-but-unscored, legacy, stale, or malformed persisted rows, then proving the live review entrypoint falls open to coarse/generic behavior unless a retained contributor profile is explicitly trustworthy.
**Demo:** A review-path scenario using real stored profile states shows linked-but-unscored and legacy profiles fail open instead of surfacing `profile-backed` newcomer guidance, while a calibrated retained contributor drives the shipped prompt and Review Details coherently on the GitHub review surface.

## Must-Haves

- Persist explicit contributor-profile trust metadata so review-time code can distinguish linked-unscored, legacy, stale, malformed, and M047-calibrated rows without inferring trust from `overall_tier` alone.
- Only trustworthy calibrated contributor profiles may resolve to `profile-backed`; untrusted stored rows must fall through to author-cache/search/generic behavior instead of masquerading as newcomer truth.
- GitHub review prompt shaping, Review Details, and author-classification logs must stay coherent when the stored profile is linked-unscored, legacy, stale, opted-out, calibrated, or contradicted by low-confidence cache data.
- `scripts/verify-m047-s01.ts` must prove stored-profile runtime resolution directly while `scripts/verify-m045-s01.ts` stays green as the public contract guard.

## Threat Surface

- **Abuse**: A newly linked or legacy contributor row can otherwise masquerade as trustworthy `profile-backed` newcomer guidance unless review-time code explicitly distinguishes unscored, stale, or pre-M047-calibrated rows.
- **Data exposure**: Review Details and classification logs may expose contract state, trust state, and fallback reason, but must never reveal Slack IDs, profile IDs, raw expertise scores, or private calibration internals.
- **Input trust**: `contributor_profiles` rows, `last_scored_at`, the new calibration marker, `author_cache` entries, and GitHub association/search signals are all untrusted until the trust-aware resolver normalizes them into the shipped contributor-experience contract.

## Requirement Impact

- **Requirements touched**: R046 — this slice makes the shipped GitHub review path honor the explicit contributor-experience contract truthfully instead of trusting raw persisted tiers.
- **Re-verify**: `src/handlers/review.test.ts`, `scripts/verify-m045-s01.ts`, and the new `scripts/verify-m047-s01.ts` must agree on prompt, Review Details, and fail-open source resolution across stored-profile scenarios.
- **Decisions revisited**: D086, D087, D088.

## Proof Level

- This slice proves: integration proof on deterministic GitHub review-path scenarios seeded from real stored contributor-profile row states.
- Real runtime required: no.
- Human/UAT required: no.

## Verification

- `bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts ./scripts/verify-m047-s01.test.ts`
- `bun run verify:m045:s01 && bun run verify:m047:s01`
- `bun run tsc --noEmit`

## Observability / Diagnostics

- Runtime signals: author-classification logs should expose stored-profile trust state, trust reason, calibration marker/version, contract state, and fallback/degradation path.
- Inspection surfaces: `scripts/verify-m047-s01.ts`, `src/handlers/review.test.ts`, and the emitted review-path log entry for contributor classification.
- Failure visibility: linked-unscored/legacy/stale regressions should surface as the wrong trust state, the wrong contract state, or a verifier scenario failure with a named status code.
- Redaction constraints: do not expose Slack IDs, contributor profile IDs, raw expertise scores, or internal calibration-only metadata in Review Details.

## Integration Closure

- Upstream surfaces consumed: `src/db/migrations/011-contributor-profiles.sql`, `src/contributor/profile-store.ts`, `src/contributor/expertise-scorer.ts`, `src/contributor/experience-contract.ts`, `src/handlers/review.ts`, and the existing `verify:m045:s01` contract harness.
- New wiring introduced in this slice: a persisted contributor-profile trust boundary feeds review-time source resolution before prompt shaping and Review Details rendering.
- What remains before the milestone is truly usable end-to-end: S02 must roll the same trust-aware resolution through Slack/profile continuity and retrieval surfaces; S03 must compose this runtime resolver proof into `verify:m047`.

## Tasks

- [x] **T01: Persist contributor-profile trust metadata and classify stored profile states** `est:2h`
  - Why: The review path cannot stop overclaiming until stored contributor rows can distinguish a newly linked placeholder or legacy score from a trustworthy calibrated row.
  - Files: `src/db/migrations/037-contributor-profile-trust.sql`, `src/db/migrations/037-contributor-profile-trust.down.sql`, `src/contributor/types.ts`, `src/contributor/profile-store.ts`, `src/contributor/profile-store.test.ts`, `src/contributor/profile-trust.ts`, `src/contributor/profile-trust.test.ts`
  - Do: Add a migration-backed trust marker and a narrow trust helper, teach the profile store to read/write the metadata, and cover linked-unscored, legacy, stale, malformed, and calibrated stored-profile states in focused tests.
  - Verify: `bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts`
  - Done when: Stored contributor rows can be classified truthfully without inferring trust from raw `overall_tier`, and freshly scored rows are stamped as current M047-calibrated data.

- [ ] **T02: Route GitHub review resolution through the trust-aware profile boundary** `est:2h`
  - Why: The live review entrypoint is the root-cause surface; it must use the new persisted trust boundary before it decides whether contributor experience is `profile-backed`, coarse fallback, or generic.
  - Files: `src/contributor/profile-trust.ts`, `src/contributor/review-author-resolution.ts`, `src/contributor/review-author-resolution.test.ts`, `src/handlers/review.ts`, `src/handlers/review.test.ts`
  - Do: Wire the trust helper into review-time author classification, keep opt-out precedence, allow only trustworthy calibrated rows to stay `profile-backed`, and make untrusted rows fall through to cache/search/generic behavior while logging the trust/fallback path.
  - Verify: `bun test ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts`
  - Done when: Linked-unscored, legacy, stale, malformed, and opted-out stored rows fail open truthfully, while a trustworthy calibrated retained row still drives coherent prompt and Review Details behavior.

- [ ] **T03: Ship an operator proof harness for stored-profile review resolution** `est:90m`
  - Why: M047 needs a durable proof surface for the real runtime resolver, not just the public contract fixture harness from M045.
  - Files: `scripts/verify-m047-s01.ts`, `scripts/verify-m047-s01.test.ts`, `package.json`, `src/contributor/review-author-resolution.ts`, `src/handlers/review.ts`
  - Do: Add a scenario-driven verifier that seeds stored contributor-profile states through the trust-aware review-resolution seam, renders prompt and Review Details outcomes, reports trust/contract/fallback diagnostics, and keeps `verify:m045:s01` green alongside the new runtime proof.
  - Verify: `bun test ./scripts/verify-m047-s01.test.ts && bun run verify:m045:s01 && bun run verify:m047:s01 && bun run tsc --noEmit`
  - Done when: The shipped verifier reports linked-unscored, legacy, stale, calibrated, opt-out, and coarse-fallback outcomes with stable check IDs and scenario details.

## Files Likely Touched

- `src/db/migrations/037-contributor-profile-trust.sql`
- `src/db/migrations/037-contributor-profile-trust.down.sql`
- `src/contributor/types.ts`
- `src/contributor/profile-store.ts`
- `src/contributor/profile-store.test.ts`
- `src/contributor/profile-trust.ts`
- `src/contributor/profile-trust.test.ts`
- `src/contributor/review-author-resolution.ts`
- `src/contributor/review-author-resolution.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `scripts/verify-m047-s01.ts`
- `scripts/verify-m047-s01.test.ts`
- `package.json`
