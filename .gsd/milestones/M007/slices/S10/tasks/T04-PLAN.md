# T04: 39-language-aware-enforcement 04

**Slice:** S10 — **Milestone:** M007

## Description

Wire the enforcement module into the review pipeline and create the barrel export, completing the language-aware enforcement feature.

Purpose: Connect all enforcement components (tooling detection, tooling suppression, severity floors) into the live review handler so that published reviews actually enforce language-specific rules. This is the final integration that makes the phase success criteria observable.

Output: `src/enforcement/index.ts` barrel export, updated `src/handlers/review.ts` with enforcement pipeline integration.

## Must-Haves

- [ ] "Enforcement pipeline runs between finding extraction and existing suppression matching in review.ts"
- [ ] "Tooling suppression marks findings as toolingSuppressed, which are then treated as suppressed in the existing pipeline"
- [ ] "Severity floor elevation modifies finding.severity before suppression matching and confidence computation"
- [ ] "Enforcement operates fail-open: any error in enforcement logs a warning and returns findings unchanged"
- [ ] "Existing review pipeline behavior is preserved -- enforcement is additive, not replacement"
- [ ] "Enforcement metadata (originalSeverity, enforcementPatternId, toolingSuppressed) flows to knowledge store"

## Files

- `src/enforcement/index.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
