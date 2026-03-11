# S01: Timeout Resilience

**Goal:** Create the timeout estimation engine and wire dynamic timeouts into the executor.
**Demo:** Create the timeout estimation engine and wire dynamic timeouts into the executor.

## Must-Haves


## Tasks

- [x] **T01: 51-timeout-resilience 01** `est:3min`
  - Create the timeout estimation engine and wire dynamic timeouts into the executor.

Purpose: TMO-01 (estimate timeout risk from PR metrics) and TMO-04 (dynamic timeout scaling) form the foundation that Plan 02 builds on for scope reduction and informative messages.

Output: A pure-function timeout estimator module with tests, ExecutionContext extended with dynamicTimeoutSeconds, executor using the dynamic value, and config schema supporting timeout tuning flags.
- [x] **T02: 51-timeout-resilience 02** `est:3min`
  - Integrate timeout estimation into the review handler for scope reduction and informative timeout messages.

Purpose: TMO-02 (auto-reduce scope for high-risk PRs) and TMO-03 (informative timeout messages instead of generic errors). This completes all four timeout resilience requirements.

Output: Review handler that estimates timeout risk before execution, reduces scope when appropriate, and posts informative messages on timeout with partial review context.
- [x] **T03: 51-timeout-resilience 03** `est:1min`
  - Fix test gap: add timeout_partial coverage to errors.test.ts.

Purpose: The verification report found that errors.test.ts was not updated when timeout_partial was added to ErrorCategory. The expectedHeaders Record<ErrorCategory, string> is missing the new category, causing TypeScript compilation failure. This plan adds the missing test coverage.

## Files Likely Touched

- `src/lib/timeout-estimator.ts`
- `src/lib/timeout-estimator.test.ts`
- `src/execution/types.ts`
- `src/execution/executor.ts`
- `src/execution/config.ts`
- `src/handlers/review.ts`
- `src/lib/errors.ts`
- `src/lib/errors.test.ts`
