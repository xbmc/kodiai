# S03: Dependency Bump Detection

**Goal:** Implement the dependency bump detection pipeline as a pure-function module with three stages: detect (DEP-01), extract (DEP-02), and classify (DEP-03).
**Demo:** Implement the dependency bump detection pipeline as a pure-function module with three stages: detect (DEP-01), extract (DEP-02), and classify (DEP-03).

## Must-Haves


## Tasks

- [x] **T01: 53-dependency-bump-detection 01** `est:2min`
  - Implement the dependency bump detection pipeline as a pure-function module with three stages: detect (DEP-01), extract (DEP-02), and classify (DEP-03).

Purpose: Enable Kodiai to identify, parse, and classify dependency bump PRs from Dependabot/Renovate so downstream review prompts can provide dependency-aware feedback.
Output: `src/lib/dep-bump-detector.ts` with three exported functions + comprehensive test file.
- [x] **T02: 53-dependency-bump-detection 02** `est:4min`
  - Wire the dependency bump detection pipeline into the review handler and prompt builder so detected bumps produce dependency-aware review instructions.

Purpose: Complete the end-to-end integration so Kodiai reviews provide tailored feedback for dependency bump PRs.
Output: Modified review.ts (detection wiring), modified review-prompt.ts (prompt section), new tests.

## Files Likely Touched

- `src/lib/dep-bump-detector.ts`
- `src/lib/dep-bump-detector.test.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
