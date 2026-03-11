# S01: Commit Message Keywords Pr Intent

**Goal:** Implement the PR intent parser as a pure function with comprehensive test coverage using TDD.
**Demo:** Implement the PR intent parser as a pure function with comprehensive test coverage using TDD.

## Must-Haves


## Tasks

- [x] **T01: 42-commit-message-keywords-pr-intent 01** `est:12min`
  - Implement the PR intent parser as a pure function with comprehensive test coverage using TDD.

Purpose: Create the core parsing engine that extracts structured review intent signals from PR metadata (title bracket tags, conventional commit prefixes, breaking change keywords, commit message scanning). This is a pure function with zero side effects -- no API calls, no I/O.

Output: `src/lib/pr-intent-parser.ts` (parser + types + section builder) and `src/lib/pr-intent-parser.test.ts` (tests).
- [x] **T02: 42-commit-message-keywords-pr-intent 02** `est:18min`
  - Wire the PR intent parser into the review handler pipeline, including commit message fetching, [no-review] skip logic, keyword-driven overrides, and Review Details transparency output.

Purpose: Connect the pure parser (Plan 01) to the live review pipeline so keyword signals actually influence review behavior. This is the integration glue that makes the parser useful.

Output: Modified `src/handlers/review.ts` (integration) and `src/execution/review-prompt.ts` (conventional commit context).

## Files Likely Touched

- `src/lib/pr-intent-parser.ts`
- `src/lib/pr-intent-parser.test.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
