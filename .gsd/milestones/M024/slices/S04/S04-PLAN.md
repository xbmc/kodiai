# S04: Severity Demotion

**Goal:** Implement severity demotion for findings whose core claims depend on unverified external knowledge.
**Demo:** Implement severity demotion for findings whose core claims depend on unverified external knowledge.

## Must-Haves


## Tasks

- [x] **T01: 118-severity-demotion 01** `est:3min`
  - Implement severity demotion for findings whose core claims depend on unverified external knowledge.

Purpose: Prevent hallucinated CRITICALs from bypassing suppression by capping primarily-external findings at medium severity. This is the enforcement layer that acts on Phase 117's claim classification results.

Output: `src/lib/severity-demoter.ts` module + tests + integration in review.ts pipeline

## Files Likely Touched

- `src/lib/severity-demoter.ts`
- `src/lib/severity-demoter.test.ts`
- `src/handlers/review.ts`
