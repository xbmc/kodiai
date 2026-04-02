---
estimated_steps: 12
estimated_files: 2
skills_used: []
---

# T02: Wire usageLimit and token fields into the review.ts call site and add integration test

Pass `result.usageLimit` and token fields to `formatReviewDetailsSummary` at the single call site in `src/handlers/review.ts` (~line 2987). Add one integration test in `src/handlers/review.test.ts` asserting the usage line appears in `detailsCommentBody` when the executor returns `usageLimit`.

Steps:
1. In `src/handlers/review.ts` at the `formatReviewDetailsSummary({...})` call (~line 2987), add two new fields after `prioritization: prioritizationStats`:
   - `usageLimit: result.usageLimit,`
   - `tokenUsage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd },`
   `result` is already in scope from `const result = await executor.execute({...})`. Both fields are optional in the function signature so this is safe even if undefined.
2. In `src/handlers/review.test.ts`, find an existing test that exercises the `detailsCommentBody` output path. Add a new `it` test (or `describe` block) that:
   - Mocks the executor to return a result with `usageLimit: { utilization: 0.8, rateLimitType: 'seven_day', resetsAt: 9999 }` and `inputTokens: 2000, outputTokens: 1000`
   - Asserts that `detailsCommentBody` contains `80% of seven_day limit`
   - Asserts that `detailsCommentBody` contains `in /`
3. Run `bun tsc --noEmit` to verify zero type errors.
4. Run `bun test ./src/handlers/review.test.ts --timeout 60000` to verify all tests pass.

## Inputs

- ``src/lib/review-utils.ts` — updated function signature from T01`
- ``src/handlers/review.ts` — call site to wire`
- ``src/handlers/review.test.ts` — existing integration tests to extend`

## Expected Output

- ``src/handlers/review.ts` — call site updated with `usageLimit` and `tokenUsage` fields`
- ``src/handlers/review.test.ts` — new integration test asserting usage line in `detailsCommentBody``

## Verification

bun tsc --noEmit && bun test ./src/handlers/review.test.ts --timeout 60000
