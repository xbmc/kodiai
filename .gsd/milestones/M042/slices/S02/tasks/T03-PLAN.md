---
estimated_steps: 2
estimated_files: 3
skills_used: []
---

# T03: Add the M042 S02 review-surface verifier

Add a dedicated slice proof harness and command that lock in the review-surface truthfulness contract after T01 and T02 settle the wording. The verifier should reuse production helpers where possible, assert on full rendered output, and encode the CrystalP-shaped case: contributor-profile tier drives the surface output, established-tier prompt/details text stays established, and newcomer/developing guidance is absent.

Follow the existing M042/S01 verifier pattern: keep the checks behavioral rather than overfitting to one exact prose paragraph, but make the banned wording assertions strict enough to catch a real regression.

## Inputs

- ``scripts/verify-m042-s01.ts``
- ``scripts/verify-m042-s01.test.ts``
- ``src/execution/review-prompt.ts``
- ``src/lib/review-utils.ts``
- ``src/handlers/review.ts``
- ``package.json``

## Expected Output

- ``scripts/verify-m042-s02.ts``
- ``scripts/verify-m042-s02.test.ts``
- ``package.json``

## Verification

bun test ./scripts/verify-m042-s02.test.ts && bun run verify:m042:s02 && bun run tsc --noEmit

## Observability Impact

`bun run verify:m042:s02` becomes the durable slice proof surface for milestone closure and downstream S03 regression checks.
