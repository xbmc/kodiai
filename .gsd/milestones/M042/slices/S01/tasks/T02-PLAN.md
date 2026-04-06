---
estimated_steps: 2
estimated_files: 5
skills_used: []
---

# T02: Wire percentile tier recalculation into score updates with fail-open behavior

Implement the smallest durable recalculation seam inside contributor scoring so both incremental and batch score updates persist a truthful tier instead of blindly reusing `profile.overallTier`. Reuse the existing percentile logic from `src/contributor/tier-calculator.ts` rather than inventing a new scoring taxonomy.

Extract or expose a reusable helper that computes a target tier from controlled score distributions, then call it from the scorer path after the updated `overallScore` is known. Preserve fail-open behavior: if the recalculation read or computation fails, the scoring path must still complete without blocking review-time background updates, and tests must prove that degradation path. Update tier-calculator tests as needed so the shared percentile contract stays anchored in one place.

## Inputs

- ``src/contributor/expertise-scorer.ts``
- ``src/contributor/expertise-scorer.test.ts``
- ``src/contributor/tier-calculator.ts``
- ``src/contributor/tier-calculator.test.ts``
- ``src/contributor/types.ts``

## Expected Output

- ``src/contributor/expertise-scorer.ts``
- ``src/contributor/expertise-scorer.test.ts``
- ``src/contributor/tier-calculator.ts``
- ``src/contributor/tier-calculator.test.ts``

## Verification

bun test ./src/contributor/expertise-scorer.test.ts && bun test ./src/contributor/tier-calculator.test.ts

## Observability Impact

Makes the recalculation/fail-open boundary testable and visible: tests should show both successful tier advancement and the degraded path where score updates still complete if tier recalculation dependencies fail.
