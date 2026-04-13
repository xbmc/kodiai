---
id: T02
parent: S01
milestone: M049
key_files:
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
key_decisions:
  - Derived approval evidence only from facts the handlers already compute (prompt file counts, repo-inspection usage, prompt coverage, and dep-bump merge confidence) so the new visible body adds no new API calls or timeout surfaces.
  - Kept the existing `review-output-key` marker and idempotency scan unchanged and only changed the visible approval body contract at the publish call sites.
duration: 
verification_result: passed
completed_at: 2026-04-13T14:39:43.565Z
blocker_discovered: false
---

# T02: Adopted the shared clean-approval body for explicit mention and automatic review approvals.

**Adopted the shared clean-approval body for explicit mention and automatic review approvals.**

## What Happened

I followed a red-green loop by first tightening `src/handlers/mention.test.ts` and `src/handlers/review.test.ts` to require the shared visible approval contract on both GitHub-visible approval lanes: `Decision: APPROVE`, `Issues: none`, an `Evidence:` block, lane-specific factual bullets, and marker continuity via `extractReviewOutputKey(...)`. After confirming those assertions failed against the old publisher behavior, I updated `src/handlers/mention.ts` so the explicit `@kodiai review` approval bridge now passes deterministic evidence into `buildApprovedReviewBody(...)` from facts the handler already had: the explicit review prompt file count and the repo-inspection-tools gate. I then updated `src/handlers/review.ts` so the automatic clean-review approval path also uses the shared body instead of a marker-only approval, carrying forward review-prompt file coverage as evidence and moving dep-bump merge confidence into the shared evidence-backed contract rather than appending it after the marker. I added automatic-review regressions for both the standard clean-approval lane and the dep-bump lane, while preserving the existing `review-output-idempotency`, `explicit-review-publish`, and `auto-approve` skip/publish behavior so duplicate publication is still suppressed under the same `reviewOutputKey`.

## Verification

Ran `bun test ./src/handlers/mention.test.ts ./src/handlers/review.test.ts`, which passed and confirmed explicit mention approvals, automatic clean approvals, dep-bump approvals, and duplicate-suppression assertions now use the shared visible body. Ran the slice verification command `bun test ./src/handlers/review-idempotency.test.ts ./src/handlers/mention.test.ts ./src/handlers/review.test.ts ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts`, which passed and preserved the helper/idempotency contract plus adjacent MCP/comment-server and mention-prompt coverage. Ran `bun run tsc --noEmit`, which exited successfully with no diagnostics. The existing observability surfaces remain inspectable through the handler test assertions around `review-output-idempotency`, `explicit-review-publish`, `auto-approve`, and published-marker extraction via `extractReviewOutputKey(...)`.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/mention.test.ts ./src/handlers/review.test.ts` | 0 | ✅ pass | 11300ms |
| 2 | `bun test ./src/handlers/review-idempotency.test.ts ./src/handlers/mention.test.ts ./src/handlers/review.test.ts ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts` | 0 | ✅ pass | 11307ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 10899ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
