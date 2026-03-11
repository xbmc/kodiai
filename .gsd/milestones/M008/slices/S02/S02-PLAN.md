# S02: Auto Profile Selection

**Goal:** Create a deterministic auto-profile resolver with TDD so PR size-to-profile selection and precedence behavior are predictable and safe.
**Demo:** Create a deterministic auto-profile resolver with TDD so PR size-to-profile selection and precedence behavior are predictable and safe.

## Must-Haves


## Tasks

- [x] **T01: 43-auto-profile-selection 01** `est:1min`
  - Create a deterministic auto-profile resolver with TDD so PR size-to-profile selection and precedence behavior are predictable and safe.

Purpose: Phase 43 must make review depth adaptive without breaking user intent. This requires one pure function that encodes threshold rules and precedence (keyword > manual config > auto).

Output: `src/lib/auto-profile.ts` with exported resolver and `src/lib/auto-profile.test.ts` with complete red/green coverage.
- [x] **T02: 43-auto-profile-selection 02** `est:3min`
  - Integrate auto-profile resolution into the review handler so runtime profile selection adapts by PR size while preserving override precedence.

Purpose: The resolver from Plan 01 must drive real review behavior and be visible to users/operators. This closes the loop from pure logic to live profile selection and observability.

Output: Updated handler/profile wiring plus tests that prove thresholds and precedence under real review execution paths.

## Files Likely Touched

- `src/lib/auto-profile.ts`
- `src/lib/auto-profile.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
