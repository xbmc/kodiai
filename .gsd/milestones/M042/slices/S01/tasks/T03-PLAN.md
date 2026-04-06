---
estimated_steps: 2
estimated_files: 7
skills_used: []
---

# T03: Prove review-source precedence with a slice verifier

Add a focused regression proving that once stored contributor tier state is corrected, the review author-tier resolution path trusts that profile state ahead of cache and fallback classification. If the current `resolveAuthorTier` shape is too private for focused testing, extract the smallest helper seam needed to test precedence without hauling the full review handler into the test. Keep the scope on source-of-truth resolution, not prompt copy changes.

Create a slice verifier for M042/S01 that exercises three checks: stuck-tier repro fixed, recalculated-tier persistence under controlled population scores, and profile-precedence over cache/fallback for a CrystalP-shaped fixture. Include one fail-open check showing that recalculation errors do not become review-blocking failures. Register the verifier in `package.json` so downstream slices can run it as the slice-level proof surface.

## Inputs

- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``
- ``src/contributor/expertise-scorer.ts``
- ``src/contributor/tier-calculator.ts``
- ``package.json``

## Expected Output

- ``src/handlers/review.test.ts``
- ``src/handlers/review.ts``
- ``scripts/verify-m042-s01.ts``
- ``scripts/verify-m042-s01.test.ts``
- ``package.json``

## Verification

bun test ./src/handlers/review.test.ts && bun test ./scripts/verify-m042-s01.test.ts && bun run verify:m042:s01 && bun run tsc --noEmit

## Observability Impact

Introduces a named verifier surface for this slice so later agents can inspect truthfulness state with one command instead of reconstructing contributor-tier behavior from scattered unit tests.
