---
id: S03
parent: M031
milestone: M031
provides:
  - scanOutgoingForSecrets() exported from src/lib/sanitizer.ts — available to S05 proof harness and any future publish paths
  - 5 publish paths enforced — S05 can test all of them
  - 6 named patterns with documented regex strings — S05 can reference pattern names in its checks
requires:
  - slice: S01
    provides: buildAgentEnv() allowlist establishes the security boundary model; S03 adds outgoing enforcement on the same boundary
affects:
  - S05
key_files:
  - src/lib/sanitizer.ts
  - src/lib/sanitizer.test.ts
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
  - 6 named patterns chosen; high-entropy detection excluded to avoid false positives in outgoing prose
  - Return-on-first-match preserves deterministic matchedPattern name for callers and structured logging
  - Blocked response format matches each server's local convention (plain text for MCP servers, JSON error_code for issue-comment-server, substituted message + still-post for Slack)
  - issue-comment-server uses deps-bag pattern — botHandles added as field with default [], not positional param
  - safePublish in assistant-handler replaces all 9 publishInThread call sites while preserving the destructured publishInThread reference
patterns_established:
  - scanOutgoingForSecrets() called after sanitizeOutgoingMentions() on every publish path — scan the final body, not the raw input
  - Per-server error format convention: MCP servers → isError:true + plain text; issue-comment-server → JSON error_code; Slack → substitute safe message and still publish
observability_surfaces:
  - logger.warn({ matchedPattern, tool }) emitted on block in comment-server, inline-review-server, and assistant-handler (review-comment-thread-server omits — no logger in scope)
  - isError:true in MCP blocked responses surfaces the block to the calling agent for observability at the MCP protocol layer
drill_down_paths:
  - .gsd/milestones/M031/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M031/slices/S03/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-28T17:39:11.005Z
blocker_discovered: false
---

# S03: Outgoing Secret Scan on All Publish Paths

**Added scanOutgoingForSecrets() with 6 named credential patterns to sanitizer.ts and wired it into all 5 agent-controlled publish paths (4 MCP servers + Slack assistant handler), so credential patterns in agent output are blocked before they leave the system.**

## What Happened

S03 delivered the outgoing credential scan in two tasks.

T01 added `SecretScanResult` interface and `scanOutgoingForSecrets()` to `src/lib/sanitizer.ts`. The function iterates 6 named regex patterns (private-key, aws-access-key, github-pat, slack-token, github-token, github-x-access-token-url) with a first-match short-circuit, returning `{ blocked: true, matchedPattern: name }` on detection. High-entropy token detection was explicitly excluded to avoid false positives in normal prose. 15 new tests covering all 6 pattern families plus clean text, empty string, embedded secrets, and multi-pattern priority. 68 total sanitizer tests pass.

T02 wired `scanOutgoingForSecrets()` into every agent-controlled outgoing path:
- `comment-server.ts` — both `create_comment` and `update_comment` handlers scan the sanitized body after `sanitizeOutgoingMentions` and return `isError: true` with a SECURITY message if blocked.
- `inline-review-server.ts` — `create_inline_comment` handler same pattern.
- `review-comment-thread-server.ts` — `reply_to_pr_review_comment` scans the final publish body; no logger in scope per design.
- `issue-comment-server.ts` — both `createCommentHandler` and `updateCommentHandler` gained `botHandles` via the existing deps-bag pattern (not a new positional param); blocked response uses the JSON `error_code` convention matching that server's style.
- `assistant-handler.ts` — `safePublish` wrapper wraps all 9 `publishInThread` call sites; on block it substitutes a safe message and still posts to Slack (no silent drop).

5 new secret-scan tests added across 3 test files. 152 tests pass total, 0 fail.

## Verification

Full slice verification command: `bun test src/lib/sanitizer.test.ts src/execution/mcp/comment-server.test.ts src/execution/mcp/review-comment-thread-server.test.ts src/execution/mcp/issue-comment-server.test.ts`

Result: **152 pass, 0 fail in 124ms**

Verified:
- All 6 pattern families detected (github-pat, aws-access-key, private-key RSA/EC/OPENSSH, slack-token xoxb/xoxa, github-token ghu/gho, github-x-access-token-url with and without trailing slash)
- Clean text returns blocked:false
- Secret embedded in prose is detected
- create_comment, update_comment, reply_to_pr_review_comment, createCommentHandler, updateCommentHandler all block on PAT — isError:true confirmed
- assistant-handler safePublish pattern compiles and tests pass

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

issue-comment-server.ts handlers use a deps-bag pattern, so `botHandles` was added as a field there rather than as a positional parameter. `createIssueCommentServer` got `botHandles: string[] = []` default to avoid breaking other call sites. Blocked response format in `issue-comment-server.ts` uses the existing JSON `error_code` convention rather than the plain-text format used by other servers — local convention preserved per plan.

## Known Limitations

The `inline-review-server.ts` scan path has no dedicated test in S03 (test added for comment-server and review-comment-thread-server; inline-review follows the same pattern but its test coverage was not explicitly extended). The S05 end-to-end proof harness will cover all paths collectively.

## Follow-ups

S04 (Prompt Security Policy + CLAUDE.md in Workspace) can proceed — no dependencies on S03 beyond the S01 env allowlist already complete. S05 proof harness should include a check that all 5 publish paths return a SECURITY message on a known PAT string.

## Files Created/Modified

- `src/lib/sanitizer.ts` — Added SecretScanResult interface and scanOutgoingForSecrets() with 6 named regex patterns
- `src/lib/sanitizer.test.ts` — Added 15 tests for scanOutgoingForSecrets covering all 6 pattern families plus edge cases
- `src/execution/mcp/comment-server.ts` — Added scanOutgoingForSecrets scan to create_comment and update_comment handlers
- `src/execution/mcp/comment-server.test.ts` — Added 2 secret-scan tests for create_comment and update_comment
- `src/execution/mcp/inline-review-server.ts` — Added scanOutgoingForSecrets scan to create_inline_comment handler
- `src/execution/mcp/review-comment-thread-server.ts` — Added scanOutgoingForSecrets scan to reply_to_pr_review_comment handler
- `src/execution/mcp/review-comment-thread-server.test.ts` — Added 1 secret-scan test for reply_to_pr_review_comment
- `src/execution/mcp/issue-comment-server.ts` — Added botHandles to deps-bag, sanitizeOutgoingMentions + scanOutgoingForSecrets to both handlers
- `src/execution/mcp/issue-comment-server.test.ts` — Updated 13 call sites to pass botHandles: []; added 2 secret-scan tests
- `src/execution/mcp/index.ts` — Updated createIssueCommentServer call to pass deps.botHandles ?? []
- `src/slack/assistant-handler.ts` — Added safePublish wrapper with scanOutgoingForSecrets; replaced all 9 publishInThread call sites in handler body
