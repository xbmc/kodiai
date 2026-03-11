# S04: Security Advisory Changelog

**Goal:** Create the dep-bump-enrichment module with security advisory lookup, changelog fetching, package-to-repo resolution, and breaking change detection using TDD.
**Demo:** Create the dep-bump-enrichment module with security advisory lookup, changelog fetching, package-to-repo resolution, and breaking change detection using TDD.

## Must-Haves


## Tasks

- [x] **T01: 54-security-advisory-changelog 01** `est:4min`
  - Create the dep-bump-enrichment module with security advisory lookup, changelog fetching, package-to-repo resolution, and breaking change detection using TDD.

Purpose: This module provides the core enrichment logic that Phase 54 success criteria depend on -- SEC-01/02/03 and CLOG-01/02/03. All functions are pure async with defined I/O, making them ideal TDD candidates.
Output: Fully tested `dep-bump-enrichment.ts` module plus extended `DepBumpContext` type.
- [x] **T02: 54-security-advisory-changelog 02** `est:3min`
  - Wire dep-bump enrichment into the review handler and extend the review prompt to render security advisory and changelog context.

Purpose: Connects the enrichment module (Plan 54-01) to the live review pipeline so users see CVE/advisory and changelog data in Kodiai reviews. Completes the end-to-end flow for all Phase 54 requirements.
Output: Updated review.ts with enrichment calls, updated review-prompt.ts with security + changelog prompt sections.

## Files Likely Touched

- `src/lib/dep-bump-enrichment.ts`
- `src/lib/dep-bump-enrichment.test.ts`
- `src/lib/dep-bump-detector.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
