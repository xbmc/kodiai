---
id: T03
parent: S04
milestone: M061
key_files:
  - src/handlers/review.ts
  - src/handlers/review.test.ts
key_decisions:
  - Used a fingerprint-first, fail-open cache policy for review prompt artifacts: any missing fingerprint signal or cache bookkeeping failure bypasses reuse and rebuilds directly.
  - Reused the same derived-cache wrapper for initial and retry review prompt builds so retry misses are truthful and automatic when scope or instructions differ.
  - Logged explicit review-derived prompt cache states (`hit`, `miss`, `degraded`, `bypass`) instead of collapsing failures into silent misses.
duration: 
verification_result: passed
completed_at: 2026-04-24T02:57:15.062Z
blocker_discovered: false
---

# T03: Added fingerprinted review prompt artifact reuse with retry-aware miss/degraded coverage and aligned retrieval-dedupe expectations.

**Added fingerprinted review prompt artifact reuse with retry-aware miss/degraded coverage and aligned retrieval-dedupe expectations.**

## What Happened

Implemented review prompt artifact reuse inside `src/handlers/review.ts` by adding a fail-open derived cache around `buildReviewPromptDetails()`, keyed by an explicit fingerprint of prompt-affecting review state. The fingerprint covers repo/PR identity, refs, changed files, profile knobs, retry/custom-instruction scope, retrieval-derived inputs, and other bounded prompt inputs, while hashing large text-bearing fields instead of storing raw prompt bodies. Initial and retry review flows now both use the same cache wrapper, but reduced-scope retries miss naturally because their narrowed file set and retry instruction change the fingerprint. I added truthful prompt-cache observability via `review-derived-prompt-cache` hit/miss/degraded/bypass logging, plus handler tests for identical-state hits, state-drift misses, retry misses, and degraded cache fallback. I also updated nearby retrieval expectation tests so they match the request-scoped duplicate-query collapse introduced earlier in the slice rather than expecting redundant variant embeddings.

## Verification

Ran `bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts` after the final code changes; all 353 tests passed. This covered the new review prompt cache hit/miss/degraded/retry scenarios as well as the surrounding review prompt and handler regressions. I also attempted LSP diagnostics on the edited TypeScript files, but no language server was available in this workspace, so test verification remained the authoritative check.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts` | 0 | ✅ pass | 6900ms |

## Deviations

Adjusted two existing retrieval orchestration assertions and one retrieval-hint assertion in `src/handlers/review.test.ts` to match the already-shipped same-query embedding dedupe behavior from T01. This was a local test expectation correction, not a plan change.

## Known Issues

`capture_thought` failed when attempting to persist the new prompt-cache pattern to the project memory store, so that reusable guidance is documented only in this task summary. LSP diagnostics were unavailable because no TypeScript language server was running in the workspace.

## Files Created/Modified

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
