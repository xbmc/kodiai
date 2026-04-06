# S02: Review-Surface Truthfulness Wiring

**Goal:** Prove and harden the review surfaces so the contributor tier resolved in S01 drives truthful prompt and Review Details wording, preventing established contributors from receiving newcomer-style guidance.
**Demo:** After this: After this, the review path uses the corrected contributor tier source consistently, and the CrystalP repro no longer receives newcomer-style author guidance in prompt/review output.

## Tasks
- [x] **T01: Added prompt regression tests that lock established and senior author tiers away from newcomer and developing guidance.** — Add focused prompt-builder regression coverage around the author-experience section so established and senior contributors cannot silently fall back to newcomer or developing guidance. If the current `buildAuthorExperienceSection()` copy is ambiguous under the new negative guards, tighten the wording in `src/execution/review-prompt.ts` without changing the S01 precedence contract.

Assumption: the existing mapping in `buildAuthorExperienceSection()` remains the correct taxonomy seam for S02 (`first-time/newcomer`, `regular/developing`, `established`, `core/senior`). Do not redesign the tier model here.
  - Estimate: 45m
  - Files: src/execution/review-prompt.ts, src/execution/review-prompt.test.ts
  - Verify: bun test ./src/execution/review-prompt.test.ts
- [ ] **T02: Prove Review Details and handler outputs stay truthful** — Extend deterministic Review Details coverage and reuse the existing captured handler harness to assert that one review run threads the resolved author tier into both user-visible surfaces. The task should verify full rendered prompt/details bodies, not proxy fields, and should stay scoped to the existing `runProfileScenario()`-style seam rather than broad end-to-end orchestration.

If `formatReviewDetailsSummary()` wording is too weak to make the tier obvious, tighten it enough to distinguish default/fallback wording from established/senior truthfulness without changing unrelated review-details structure.
  - Estimate: 1h
  - Files: src/lib/review-utils.ts, src/lib/review-utils.test.ts, src/handlers/review.test.ts
  - Verify: bun test ./src/lib/review-utils.test.ts && bun test ./src/handlers/review.test.ts
- [ ] **T03: Add the M042 S02 review-surface verifier** — Add a dedicated slice proof harness and command that lock in the review-surface truthfulness contract after T01 and T02 settle the wording. The verifier should reuse production helpers where possible, assert on full rendered output, and encode the CrystalP-shaped case: contributor-profile tier drives the surface output, established-tier prompt/details text stays established, and newcomer/developing guidance is absent.

Follow the existing M042/S01 verifier pattern: keep the checks behavioral rather than overfitting to one exact prose paragraph, but make the banned wording assertions strict enough to catch a real regression.
  - Estimate: 1h
  - Files: scripts/verify-m042-s02.ts, scripts/verify-m042-s02.test.ts, package.json
  - Verify: bun test ./scripts/verify-m042-s02.test.ts && bun run verify:m042:s02 && bun run tsc --noEmit
