# S07: Operational Resilience

**Goal:** Create the error handling foundation and timeout enforcement for Phase 7: Operational Resilience.
**Demo:** Create the error handling foundation and timeout enforcement for Phase 7: Operational Resilience.

## Must-Haves


## Tasks

- [x] **T01: 07-operational-resilience 01** `est:3min`
  - Create the error handling foundation and timeout enforcement for Phase 7: Operational Resilience.

Purpose: Both handlers (review and mention) need shared error formatting and the executor needs timeout enforcement. This plan creates the foundation that Plan 02 wires into the handlers.

Output: Error classification/formatting module (`src/lib/errors.ts`), updated executor with AbortController-based timeout, updated config with `timeoutSeconds`, updated types with `isTimeout` field.
- [x] **T02: 07-operational-resilience 02** `est:2min`
  - Wire error reporting into both handlers so that every failure path results in a user-visible, actionable error comment -- never silent failure.

Purpose: The review handler currently catches errors and only logs them (user sees nothing). The mention handler has partial error reporting but uses hardcoded messages instead of classified errors. This plan upgrades both handlers to use the shared errors module from Plan 01.

Output: Updated `src/handlers/review.ts` and `src/handlers/mention.ts` with comprehensive error reporting on all failure paths.

## Files Likely Touched

- `src/lib/errors.ts`
- `src/lib/errors.test.ts`
- `src/execution/types.ts`
- `src/execution/config.ts`
- `src/execution/executor.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
