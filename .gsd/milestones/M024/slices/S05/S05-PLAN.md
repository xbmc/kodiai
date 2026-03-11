# S05: Output Filtering

**Goal:** Implement output filtering for findings with external knowledge claims before publishing.
**Demo:** Implement output filtering for findings with external knowledge claims before publishing.

## Must-Haves


## Tasks

- [x] **T01: 119-output-filtering 01** `est:2min`
  - Implement output filtering for findings with external knowledge claims before publishing.

Purpose: This is the final gate in the epistemic pipeline. Claim-classifier (Phase 117) labeled claims, severity-demoter (Phase 118) capped severity, and now this filter either rewrites mixed findings (removing external-knowledge sentences while preserving the diff-grounded core) or suppresses primarily-external findings entirely. Suppressed findings appear in a collapsed section of the review summary for transparency.

Output: `src/lib/output-filter.ts` module + tests + integration in review.ts pipeline

## Files Likely Touched

- `src/lib/output-filter.ts`
- `src/lib/output-filter.test.ts`
- `src/handlers/review.ts`
