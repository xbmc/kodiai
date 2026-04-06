---
estimated_steps: 2
estimated_files: 3
skills_used: []
---

# T01: Reproduce the stuck-tier defect with scorer regressions

Add deterministic regression coverage around contributor score updates so the slice starts by proving the real defect: `overallScore` changes while `overallTier` remains the stale stored value. Build fixtures that control the full score distribution rather than asserting absolute score thresholds, and shape one fixture after the CrystalP failure mode: a contributor profile stored as `newcomer` despite enough accumulated expertise to rank above the low tier.

Use light fake-store seams rather than DB integration. Capture the `updateTier` arguments from `updateExpertiseIncremental()` and any shared helper seams you introduce so the repro is explicit about stale-tier persistence. If extracting a reusable helper is required to keep the test surgical, do that inside contributor scoring code rather than through the review prompt path.

## Inputs

- ``src/contributor/expertise-scorer.ts``
- ``src/contributor/expertise-scorer.test.ts``
- ``src/contributor/types.ts``

## Expected Output

- ``src/contributor/expertise-scorer.test.ts``
- ``src/contributor/expertise-scorer.ts``

## Verification

bun test ./src/contributor/expertise-scorer.test.ts

## Observability Impact

Adds explicit regression evidence around the `updateTier` call contract so future agents can inspect whether stale-tier preservation or recalculated-tier persistence is happening from test output alone.
