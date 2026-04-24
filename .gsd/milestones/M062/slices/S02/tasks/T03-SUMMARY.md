---
id: T03
parent: S02
milestone: M062
key_files:
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - src/lib/partial-review-formatter.ts
  - src/lib/partial-review-formatter.test.ts
key_decisions:
  - Retry merge now treats merged checkpoint evidence as the canonical source for normalized first-pass coverage and refreshes both visible publication surfaces from that same payload.
  - Bounded max-turns fallback now publishes Review Details through the shared formatter contract instead of leaving that failure branch on comment-only prose.
duration: 
verification_result: passed
completed_at: 2026-04-24T04:44:32.198Z
blocker_discovered: false
---

# T03: Unified timeout, retry-merge, and max-turns publication paths around the shared bounded first-pass comment and Review Details contract.

**Unified timeout, retry-merge, and max-turns publication paths around the shared bounded first-pass comment and Review Details contract.**

## What Happened

I followed the task’s constrained-branch scope and traced the timeout publication, retry merge, and exhausted `max_turns` fallback paths in `src/handlers/review.ts` back to the shared formatter contract established in T01/T02. I wrote the handler integration coverage first in `src/handlers/review.test.ts` for two missing branch-closure cases: retry merge had to refresh both the bounded public comment and Review Details from merged checkpoint evidence, and bounded max-turns fallback had to publish Review Details instead of leaving that branch comment-only. After reproducing those failures, I updated the retry merge path to normalize visible state from merged checkpoint scope rather than the original timeout checkpoint, then refresh both the partial comment and Review Details from the same merged `reviewFirstPass` payload so coverage, remaining scope, and continuation state stay coherent. I also updated the bounded max-turns failure fallback to publish Review Details via the same shared formatter path used elsewhere, instead of relying on branch-local prose. While wiring the retry path, the new test exposed a second-order formatter bug: once merged first-pass coverage became canonical, the retry banner still added `retryFilesReviewed` on top of that merged total and overstated progress. I fixed that in `src/lib/partial-review-formatter.ts` and tightened its test to treat shared `coveredScope` as the canonical post-merge total. I attempted to persist a reusable pattern note with `capture_thought`, but the memory write failed, so no cross-session memory was saved from this task.

## Verification

Ran the task’s required handler suite and compile gate after the final code changes, plus the targeted formatter regression that the retry-merge fix introduced. `bun test ./src/handlers/review.test.ts` passed with 135/135 tests, including the new timeout retry-merge parity assertions and bounded max-turns Review Details coverage. `bun run tsc --noEmit` completed with exit code 0. I also ran `bun test ./src/lib/partial-review-formatter.test.ts` to verify the retry banner no longer double-counts merged coverage and that the shared formatter contract remains truthful.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/lib/partial-review-formatter.test.ts` | 0 | ✅ pass | 23ms |
| 2 | `bun test ./src/handlers/review.test.ts` | 0 | ✅ pass | 5109ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 9366ms |

## Deviations

Extended `src/lib/partial-review-formatter.ts` and its unit test alongside the planned handler/test changes because the retry-merge handler fix exposed a formatter-level double-counting bug that would otherwise keep the visible contract inconsistent.

## Known Issues

`capture_thought` failed when I tried to save a reusable retry-merge pattern note, so no memory entry was recorded. No known code issues remain from this task.

## Files Created/Modified

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/lib/partial-review-formatter.ts`
- `src/lib/partial-review-formatter.test.ts`
