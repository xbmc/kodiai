---
id: T02
parent: S03
milestone: M031
provides: []
requires: []
affects: []
key_files: ["src/execution/mcp/comment-server.ts", "src/execution/mcp/comment-server.test.ts", "src/execution/mcp/inline-review-server.ts", "src/execution/mcp/review-comment-thread-server.ts", "src/execution/mcp/review-comment-thread-server.test.ts", "src/execution/mcp/issue-comment-server.ts", "src/execution/mcp/issue-comment-server.test.ts", "src/execution/mcp/index.ts", "src/slack/assistant-handler.ts"]
key_decisions: ["issue-comment-server handlers use deps-bag pattern so botHandles added as field not positional param", "Scan block in issue-comment-server returns JSON error_code: SECRET_SCAN_BLOCKED matching existing JSON convention; comment-server returns plain text matching its convention", "safePublish wraps publishInThread in assistant-handler and replaces all 9 call sites while preserving the destructuring", "review-comment-thread-server omits logger.warn on block — no logger in that scope per plan"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test src/lib/sanitizer.test.ts src/execution/mcp/comment-server.test.ts src/execution/mcp/review-comment-thread-server.test.ts src/execution/mcp/issue-comment-server.test.ts — 152 pass, 0 fail in 125ms."
completed_at: 2026-03-28T17:36:54.032Z
blocker_discovered: false
---

# T02: Wired scanOutgoingForSecrets() into all 5 publish paths (4 MCP servers + Slack handler); 152 tests pass, 0 fail

> Wired scanOutgoingForSecrets() into all 5 publish paths (4 MCP servers + Slack handler); 152 tests pass, 0 fail

## What Happened
---
id: T02
parent: S03
milestone: M031
key_files:
  - src/execution/mcp/comment-server.ts
  - src/execution/mcp/comment-server.test.ts
  - src/execution/mcp/inline-review-server.ts
  - src/execution/mcp/review-comment-thread-server.ts
  - src/execution/mcp/review-comment-thread-server.test.ts
  - src/execution/mcp/issue-comment-server.ts
  - src/execution/mcp/issue-comment-server.test.ts
  - src/execution/mcp/index.ts
  - src/slack/assistant-handler.ts
key_decisions:
  - issue-comment-server handlers use deps-bag pattern so botHandles added as field not positional param
  - Scan block in issue-comment-server returns JSON error_code: SECRET_SCAN_BLOCKED matching existing JSON convention; comment-server returns plain text matching its convention
  - safePublish wraps publishInThread in assistant-handler and replaces all 9 call sites while preserving the destructuring
  - review-comment-thread-server omits logger.warn on block — no logger in that scope per plan
duration: ""
verification_result: passed
completed_at: 2026-03-28T17:36:54.032Z
blocker_discovered: false
---

# T02: Wired scanOutgoingForSecrets() into all 5 publish paths (4 MCP servers + Slack handler); 152 tests pass, 0 fail

**Wired scanOutgoingForSecrets() into all 5 publish paths (4 MCP servers + Slack handler); 152 tests pass, 0 fail**

## What Happened

Added scanOutgoingForSecrets import and scan blocks to comment-server (create_comment, update_comment), inline-review-server (create_inline_comment), review-comment-thread-server (reply_to_pr_review_comment), and issue-comment-server (createCommentHandler, updateCommentHandler). Added botHandles parameter to issue-comment-server handlers and factory; updated index.ts call site. In assistant-handler.ts, added safePublish wrapper and replaced all 9 publishInThread call sites in the handler body. Added 5 new secret-scan tests across 3 test files; updated 13 existing handler call sites in issue-comment-server.test.ts to pass botHandles: [].

## Verification

bun test src/lib/sanitizer.test.ts src/execution/mcp/comment-server.test.ts src/execution/mcp/review-comment-thread-server.test.ts src/execution/mcp/issue-comment-server.test.ts — 152 pass, 0 fail in 125ms.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/lib/sanitizer.test.ts src/execution/mcp/comment-server.test.ts src/execution/mcp/review-comment-thread-server.test.ts src/execution/mcp/issue-comment-server.test.ts` | 0 | ✅ pass | 125ms |


## Deviations

issue-comment-server handlers use a deps-bag pattern so botHandles was added as a field there rather than a positional parameter. createIssueCommentServer got botHandles: string[] = [] default to avoid breaking other call sites.

## Known Issues

None.

## Files Created/Modified

- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/comment-server.test.ts`
- `src/execution/mcp/inline-review-server.ts`
- `src/execution/mcp/review-comment-thread-server.ts`
- `src/execution/mcp/review-comment-thread-server.test.ts`
- `src/execution/mcp/issue-comment-server.ts`
- `src/execution/mcp/issue-comment-server.test.ts`
- `src/execution/mcp/index.ts`
- `src/slack/assistant-handler.ts`


## Deviations
issue-comment-server handlers use a deps-bag pattern so botHandles was added as a field there rather than a positional parameter. createIssueCommentServer got botHandles: string[] = [] default to avoid breaking other call sites.

## Known Issues
None.
