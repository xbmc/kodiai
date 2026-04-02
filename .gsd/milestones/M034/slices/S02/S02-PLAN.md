# S02: Render usage and tokens in Review Details

**Goal:** Render `usageLimit` and token usage in the Review Details GitHub comment section by extending `formatReviewDetailsSummary` with two optional params and wiring them from the call site in `review.ts`.
**Demo:** After this: After this, the GitHub PR comment's Review Details section shows usage percentage, reset timing, token usage, and cost.

## Tasks
- [x] **T01: Extended formatReviewDetailsSummary with optional usageLimit and tokenUsage params that render usage-percentage and token-count lines into the Review Details section, with 3 passing unit tests and zero type errors** — Add two optional params to `formatReviewDetailsSummary` in `src/lib/review-utils.ts` and push the usage line and token line into the `sections` array when fields are present. Create `src/lib/review-utils.test.ts` with unit tests covering: renders usage line when present, renders token line when present, omits both when absent.

Steps:
1. In `src/lib/review-utils.ts`, add two optional params to the `formatReviewDetailsSummary` params type:
   - `usageLimit?: { utilization: number | undefined; rateLimitType: string | undefined; resetsAt: number | undefined; }` (matches `ExecutionResult['usageLimit']` exactly — do not import the type, inline the same shape)
   - `tokenUsage?: { inputTokens: number | undefined; outputTokens: number | undefined; costUsd: number | undefined; }`
2. Destructure the new params inside the function body alongside the existing destructuring.
3. After the `Review completed:` line push (i.e., after the initial `sections` array literal is built) and before the `largePRTriage` block, insert two conditional pushes:
   - If `usageLimit?.utilization !== undefined`: compute `pct = Math.round(utilization * 100)`, `type = rateLimitType ?? 'usage'`, `resetStr = resetsAt !== undefined ? ` | resets ${new Date(resetsAt * 1000).toISOString()}` : ''`, push `- Claude Code usage: ${pct}% of ${type} limit${resetStr}`
   - If `tokenUsage?.inputTokens !== undefined || tokenUsage?.outputTokens !== undefined`: compute `inp = inputTokens ?? 0`, `out = outputTokens ?? 0`, `costStr = costUsd !== undefined ? ` | ${costUsd.toFixed(4)}` : ''`, push `- Tokens: ${inp.toLocaleString()} in / ${out.toLocaleString()} out${costStr}`
4. Create `src/lib/review-utils.test.ts` with three tests under `describe('formatReviewDetailsSummary')` that call the function directly with a minimal valid params object:
   - Test 1 ('renders usage line when usageLimit is present'): pass `usageLimit: { utilization: 0.75, rateLimitType: 'seven_day', resetsAt: 1735000000 }`. Assert result contains `75% of seven_day limit`. Assert result contains `resets `. Assert result does NOT contain `Claude Code usage` when called without usageLimit.
   - Test 2 ('renders token line when tokenUsage is present'): pass `tokenUsage: { inputTokens: 1000, outputTokens: 500, costUsd: 0.0123 }`. Assert result contains `in /` and `out`. Assert result contains `0.0123`. Do NOT assert on the locale-formatted numbers themselves.
   - Test 3 ('omits usage and token lines when fields absent'): call without `usageLimit` or `tokenUsage`. Assert result does NOT contain `Claude Code usage:` and does NOT contain `Tokens:`.
5. Run `bun test ./src/lib/review-utils.test.ts` to verify all tests pass.
6. Run `bun tsc --noEmit` to verify zero type errors.
  - Estimate: 45m
  - Files: src/lib/review-utils.ts, src/lib/review-utils.test.ts
  - Verify: bun test ./src/lib/review-utils.test.ts && bun tsc --noEmit
- [x] **T02: Wired result.usageLimit and token fields into formatReviewDetailsSummary call site in review.ts and added integration test confirming usage line in detailsCommentBody** — Pass `result.usageLimit` and token fields to `formatReviewDetailsSummary` at the single call site in `src/handlers/review.ts` (~line 2987). Add one integration test in `src/handlers/review.test.ts` asserting the usage line appears in `detailsCommentBody` when the executor returns `usageLimit`.

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
  - Estimate: 30m
  - Files: src/handlers/review.ts, src/handlers/review.test.ts
  - Verify: bun tsc --noEmit && bun test ./src/handlers/review.test.ts --timeout 60000
