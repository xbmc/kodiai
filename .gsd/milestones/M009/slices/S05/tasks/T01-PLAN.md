# T01: 55-merge-confidence-scoring 01

**Slice:** S05 — **Milestone:** M009

## Description

Create the `computeMergeConfidence` pure function that maps dependency bump signal combinations (semver classification, advisory status, breaking change detection) to a categorical confidence level (high/medium/low) with rationale strings.

Purpose: CONF-01 requires a composite merge confidence score from semver analysis, advisory status, and breaking change signals. This function is the scoring engine.
Output: `src/lib/merge-confidence.ts` with exported types and function, `src/lib/merge-confidence.test.ts` with full coverage.

## Must-Haves

- [ ] "computeMergeConfidence returns high for patch bump with no advisories and no breaking changes"
- [ ] "computeMergeConfidence returns low for major bump with critical/high advisory"
- [ ] "computeMergeConfidence returns low for major bump with confirmed breaking changes in changelog"
- [ ] "computeMergeConfidence returns medium for major bump without critical advisories"
- [ ] "Security-motivated bumps (isSecurityBump=true) do not downgrade confidence for advisory presence"
- [ ] "Null enrichment data adds 'unavailable' rationale and does not crash"
- [ ] "Group bumps with limited signals produce medium confidence with appropriate rationale"

## Files

- `src/lib/merge-confidence.ts`
- `src/lib/merge-confidence.test.ts`
