# S01: Repro and Tier-State Correction

**Goal:** Reproduce the CrystalP-shaped stuck-tier defect, wire truthful contributor-tier recalculation into score updates, and prove the corrected stored tier becomes the review path’s trusted source before cache or fallback classification.
**Demo:** After this: After this, we can reproduce the CrystalP misclassification path, prove whether stored contributor tiers are stuck, and show the profile can advance out of the wrong low tier under real scoring inputs or corrected recalculation behavior.

## Tasks
- [x] **T01: Added deterministic scorer regressions that prove contributor score updates can increase overallScore while still persisting the stale stored tier.** — Add deterministic regression coverage around contributor score updates so the slice starts by proving the real defect: `overallScore` changes while `overallTier` remains the stale stored value. Build fixtures that control the full score distribution rather than asserting absolute score thresholds, and shape one fixture after the CrystalP failure mode: a contributor profile stored as `newcomer` despite enough accumulated expertise to rank above the low tier.

Use light fake-store seams rather than DB integration. Capture the `updateTier` arguments from `updateExpertiseIncremental()` and any shared helper seams you introduce so the repro is explicit about stale-tier persistence. If extracting a reusable helper is required to keep the test surgical, do that inside contributor scoring code rather than through the review prompt path.
  - Estimate: 45m
  - Files: src/contributor/expertise-scorer.ts, src/contributor/expertise-scorer.test.ts, src/contributor/types.ts
  - Verify: bun test ./src/contributor/expertise-scorer.test.ts
- [x] **T02: Wired percentile tier recalculation into contributor score updates with fail-open fallback.** — Implement the smallest durable recalculation seam inside contributor scoring so both incremental and batch score updates persist a truthful tier instead of blindly reusing `profile.overallTier`. Reuse the existing percentile logic from `src/contributor/tier-calculator.ts` rather than inventing a new scoring taxonomy.

Extract or expose a reusable helper that computes a target tier from controlled score distributions, then call it from the scorer path after the updated `overallScore` is known. Preserve fail-open behavior: if the recalculation read or computation fails, the scoring path must still complete without blocking review-time background updates, and tests must prove that degradation path. Update tier-calculator tests as needed so the shared percentile contract stays anchored in one place.
  - Estimate: 1h15m
  - Files: src/contributor/expertise-scorer.ts, src/contributor/expertise-scorer.test.ts, src/contributor/tier-calculator.ts, src/contributor/tier-calculator.test.ts, src/contributor/types.ts
  - Verify: bun test ./src/contributor/expertise-scorer.test.ts && bun test ./src/contributor/tier-calculator.test.ts
- [x] **T03: Added a review-tier precedence seam and named slice verifier proving corrected contributor tiers outrank cache and fallback classification.** — Add a focused regression proving that once stored contributor tier state is corrected, the review author-tier resolution path trusts that profile state ahead of cache and fallback classification. If the current `resolveAuthorTier` shape is too private for focused testing, extract the smallest helper seam needed to test precedence without hauling the full review handler into the test. Keep the scope on source-of-truth resolution, not prompt copy changes.

Create a slice verifier for M042/S01 that exercises three checks: stuck-tier repro fixed, recalculated-tier persistence under controlled population scores, and profile-precedence over cache/fallback for a CrystalP-shaped fixture. Include one fail-open check showing that recalculation errors do not become review-blocking failures. Register the verifier in `package.json` so downstream slices can run it as the slice-level proof surface.
  - Estimate: 1h
  - Files: src/handlers/review.ts, src/handlers/review.test.ts, src/contributor/expertise-scorer.ts, src/contributor/tier-calculator.ts, scripts/verify-m042-s01.ts, scripts/verify-m042-s01.test.ts, package.json
  - Verify: bun test ./src/handlers/review.test.ts && bun test ./scripts/verify-m042-s01.test.ts && bun run verify:m042:s01 && bun run tsc --noEmit
