---
id: T02
parent: S01
milestone: M063
key_files:
  - src/handlers/review.ts
key_decisions:
  - Delegated bounded first-pass continuation scheduling and queued-result settlement to the explicit lifecycle module while keeping the handler’s real queue/executor path intact.
  - Preserved a handler-local reduced-scope retry fallback for zero-evidence timeouts so the shipped no-publication retry behavior remains intact even though the lifecycle planner correctly suppresses publishable continuation state for zero-evidence runs.
  - Kept publish-authority rechecks at every visible continuation mutation point so queued follow-up cannot update the bounded comment or Review Details after supersession.
duration: 
verification_result: passed
completed_at: 2026-04-24T05:31:57.091Z
blocker_discovered: false
---

# T02: Refactored review timeout continuation wiring onto the explicit lifecycle seam while preserving real queued follow-up execution and publish-authority guards.

**Refactored review timeout continuation wiring onto the explicit lifecycle seam while preserving real queued follow-up execution and publish-authority guards.**

## What Happened

I replaced the handler-local timeout continuation planning/merge logic in `src/handlers/review.ts` with orchestration through `planReviewContinuation(...)` and `settleReviewContinuation(...)` from the extracted lifecycle module. The bounded first-pass path now derives continuation scheduling, continuation identity, timeout/checkpoint policy, and merge-vs-settle outcomes from the explicit lifecycle seam instead of reconstructing them inline. I kept the real queued retry execution path unchanged in shape: continuation still runs as a live `review-retry` job through the handler-owned queue, reuses the real prompt/executor plumbing, and rechecks `ReviewWorkCoordinator` authority before mutating the bounded partial-review comment or Review Details. During verification I found one important shipped contract the pure seam does not cover: zero-evidence timeout must still enqueue a reduced-scope follow-up even though it cannot publish bounded first-pass output. I restored that handler-owned fallback while keeping bounded publication and settlement on the explicit lifecycle seam. I also restored the malformed merge guard so queued continuation without a base checkpoint/comment logs and exits instead of trying to settle invalid state.

## Verification

Ran the task verification command after the final code change: `bun test src/handlers/review.test.ts --filter "continuation"`. The continuation-focused handler suite passed end to end (147 pass, 0 fail), covering auto-enqueue, bounded first-pass publication, successful merge, no-delta settlement, prompt-cache retry behavior, retry telemetry, and superseded publish suppression through the real queued review path.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/handlers/review.test.ts --filter "continuation"` | 0 | ✅ pass | 6380ms |

## Deviations

Kept a small handler-local fallback for zero-evidence timeouts: the explicit lifecycle module still suppresses publishable continuation planning for zero-evidence first passes, but the live handler preserves the shipped behavior of enqueuing one reduced-scope follow-up without bounded first-pass publication. This was necessary to preserve existing product behavior and handler test coverage while still moving publishable continuation planning and settlement onto the lifecycle seam.

## Known Issues

`capture_thought` failed with `failed to create memory`, so the continuation wiring pattern could not be persisted to the project memory store during this task. No product-facing continuation verification failures remain in the targeted handler suite.

## Files Created/Modified

- `src/handlers/review.ts`
