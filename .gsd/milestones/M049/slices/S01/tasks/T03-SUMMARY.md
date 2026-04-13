---
id: T03
parent: S01
milestone: M049
key_files:
  - src/execution/mcp/comment-server.ts
  - src/execution/mcp/comment-server.test.ts
  - src/execution/mention-prompt.ts
  - src/execution/mention-prompt.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Require approve-via-comment clean approvals to use the visible shared APPROVE grammar without a `<details>` wrapper while preserving the existing wrapped NOT APPROVED decision path.
  - Keep review-output marker stamping server-side and detect approval promotion from the sanitized shared grammar rather than the legacy wrapper markers.
duration: 
verification_result: passed
completed_at: 2026-04-13T14:50:43.597Z
blocker_discovered: false
---

# T03: Aligned approve-via-comment and prompt guidance to the visible clean-approval grammar with strict evidence validation.

**Aligned approve-via-comment and prompt guidance to the visible clean-approval grammar with strict evidence validation.**

## What Happened

I updated the approve-via-comment path in TDD order. First I rewrote the focused MCP and prompt tests to pin the shared visible clean-approval grammar, including one- and three-bullet approval promotion, server-side marker stamping, prompt guidance for visible APPROVE bodies, and rejection of legacy wrapped or malformed approval near-misses. After confirming the red failures against the legacy behavior, I tightened `sanitizeKodiaiDecisionResponse(...)` so APPROVE responses now require the exact visible `Decision: APPROVE` / `Issues: none` / `Evidence:` grammar with 1–3 bullets, reject wrapped approvals and extra prose, and preserve the existing NOT APPROVED validation path. I then switched approval promotion in `create_comment` to key off the sanitized shared grammar instead of the old wrapper markers, and updated the PR approval instructions in `buildMentionPrompt(...)` so APPROVE responses are taught as visible markdown while ordinary conversational replies and NOT APPROVED decision replies keep their existing wrapper contract. I also recorded the downstream decision and the marker-bearing test harness gotcha in GSD artifacts.

## Verification

Focused approve-via-comment and prompt regressions passed after the sanitizer and prompt changes landed, including explicit checks for shared-grammar approval promotion, server-side marker stamping, and malformed approval rejection. The slice verification command then passed across `review-idempotency`, `mention`, `review`, `comment-server`, and `mention-prompt` suites, confirming the shared approval contract still holds end to end for explicit mention, automatic review, and approve-via-comment paths. `bun run tsc --noEmit` also passed cleanly.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts` | 0 | ✅ pass | 160ms |
| 2 | `bun test ./src/handlers/review-idempotency.test.ts ./src/handlers/mention.test.ts ./src/handlers/review.test.ts ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts` | 0 | ✅ pass | 9196ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 8499ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/comment-server.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
- `.gsd/KNOWLEDGE.md`
