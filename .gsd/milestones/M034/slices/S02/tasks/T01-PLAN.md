---
estimated_steps: 15
estimated_files: 2
skills_used: []
---

# T01: Extend formatReviewDetailsSummary with usageLimit and tokenUsage params, add unit tests

Add two optional params to `formatReviewDetailsSummary` in `src/lib/review-utils.ts` and push the usage line and token line into the `sections` array when fields are present. Create `src/lib/review-utils.test.ts` with unit tests covering: renders usage line when present, renders token line when present, omits both when absent.

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

## Inputs

- ``src/lib/review-utils.ts` — function to extend`
- ``src/execution/types.ts` — reference for `ExecutionResult.usageLimit` shape (do not import; inline the same shape in the params type)`

## Expected Output

- ``src/lib/review-utils.ts` — updated with `usageLimit?` and `tokenUsage?` params and conditional section pushes`
- ``src/lib/review-utils.test.ts` — new test file with 3 unit tests`

## Verification

bun test ./src/lib/review-utils.test.ts && bun tsc --noEmit
