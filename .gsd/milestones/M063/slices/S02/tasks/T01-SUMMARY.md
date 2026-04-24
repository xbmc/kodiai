---
id: T01
parent: S02
milestone: M063
key_files:
  - src/handlers/review.ts
  - src/lib/partial-review-formatter.ts
  - src/handlers/review.test.ts
key_decisions:
  - Use the bounded first-pass comment as the canonical continuation surface by embedding the base `reviewOutputKey` marker directly in that public comment.
  - Refresh nested Review Details in place on the canonical comment for same-turn timeout publication and retry merge instead of publishing a second standalone lifecycle comment.
duration: 
verification_result: passed
completed_at: 2026-04-24T05:51:20.687Z
blocker_discovered: false
---

# T01: Anchored timeout and retry continuation updates to the canonical bounded review comment with a stable review-output marker and in-place Review Details refresh.

**Anchored timeout and retry continuation updates to the canonical bounded review comment with a stable review-output marker and in-place Review Details refresh.**

## What Happened

I traced the timeout publication and retry-merge paths in `src/handlers/review.ts` and confirmed the root cause: bounded first-pass timeout comments were public but not marked with the base `reviewOutputKey`, so later continuation logic could not reliably treat that comment as the canonical review surface. I updated `formatPartialReviewComment` in `src/lib/partial-review-formatter.ts` to embed the base review-output marker on bounded first-pass and merged retry comments. In `src/handlers/review.ts` I extracted a shared `mergeReviewDetailsIntoSummaryBody` helper and changed same-turn timeout publication plus queued retry merge to refresh the already-known bounded comment body in place rather than creating or refreshing a sibling Review Details issue comment. This keeps one visible public surface while still preserving marker-based rediscovery for later continuation flows. I then tightened `src/handlers/review.test.ts` so timeout publication asserts marker continuity and nested Review Details on the bounded comment, and retry merge asserts the canonical comment is updated in place with no second lifecycle comment. I attempted to capture the reusable pattern in memory, but the memory write failed and was left non-blocking.

## Verification

Ran the task-plan verification commands after the final code changes. `bun test ./src/handlers/review.test.ts --filter "timeout"` passed, covering timeout publication, publish-right suppression, and the queued retry path with the canonical comment contract. `bun test ./src/handlers/review.test.ts --filter "retry merge"` passed, covering in-place canonical comment refresh on retry merge. I also attempted fresh LSP diagnostics on the edited files, but no TypeScript language server was available in this workspace, so the passing handler-test suite is the authoritative verification evidence for this task.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/review.test.ts --filter "timeout"` | 0 | ✅ pass | 5629ms |
| 2 | `bun test ./src/handlers/review.test.ts --filter "retry merge"` | 0 | ✅ pass | 5562ms |

## Deviations

Minor local adaptation: instead of relying on an immediate comment-list rescan right after creating the bounded timeout comment, I updated the known canonical comment body directly in the same turn and kept the base marker for later rediscovery. This preserves the slice contract while avoiding same-turn lookup fragility.

## Known Issues

`capture_thought` failed when I tried to persist the new continuation-comment pattern, so that reusable note was not saved to the memory store during this task. Also, LSP diagnostics were unavailable because no language server was running in this workspace.

## Files Created/Modified

- `src/handlers/review.ts`
- `src/lib/partial-review-formatter.ts`
- `src/handlers/review.test.ts`
