# M042: Contributor Tier Truthfulness

## Vision
Fix Kodiai's contributor-experience classification so a clearly established contributor is not labeled as a newcomer in review output, using the CrystalP `xbmc/xbmc#28132` repro to correct stored tier advancement, review-surface author labeling, and cache/fallback consistency the right way.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Repro and Tier-State Correction | high | — | ✅ | After this, we can reproduce the CrystalP misclassification path, prove whether stored contributor tiers are stuck, and show the profile can advance out of the wrong low tier under real scoring inputs or corrected recalculation behavior. |
| S02 | Review-Surface Truthfulness Wiring | medium | S01 | ✅ | After this, the review path uses the corrected contributor tier source consistently, and the CrystalP repro no longer receives newcomer-style author guidance in prompt/review output. |
| S03 | Cache, Fallback, and Regression Hardening | medium | S01, S02 | ⬜ | After this, cache reuse and fallback classification preserve truthful contributor labeling, and regressions cover the repro plus adjacent contributor-history cases so the bug does not silently return. |
