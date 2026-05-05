---
id: T02
parent: S07
milestone: M066
key_files:
  - src/handlers/mention.test.ts
key_decisions:
  - Pin the regression at the missing formatter completion evidence boundary instead of duplicating the existing passing plain-trigger route test.
duration: 
verification_result: mixed
completed_at: 2026-05-05T05:11:50.199Z
blocker_discovered: false
---

# T02: Added a red regression for the live formatter trigger observability miss on PR issue comments.

**Added a red regression for the live formatter trigger observability miss on PR issue comments.**

## What Happened

Added a focused regression in `src/handlers/mention.test.ts` for the PR #134 failure shape: a top-level PR issue comment with body `@kodiai format suggestions`, the captured delivery id, PR-head formatter configuration, and a mocked formatter result carrying a `mention-format-suggestions` reviewOutputKey. The regression verifies the request bypasses Claude, dispatches the formatter subflow with the live delivery id and formatter command, and requires the format-only completion log to include delivery id, formatter reviewOutputKey, and reviewOutputAction. The current source already routes the plain trigger to the formatter subflow, so the red boundary is the missing structured completion evidence that caused the live smoke to be indistinguishable from generic conversational handling.

## Verification

Ran `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-intent.test.ts --timeout 30000` after the test edit. It produced the intended red result: 157 tests passed and the new regression failed because `Format-only formatter suggestion request completed` lacks `deliveryId`, `reviewOutputKey`, and `reviewOutputAction` bindings. `lsp diagnostics` could not run because no language server is configured for `src/handlers/mention.test.ts`. `memory_query` also failed before edits because the local GSD memory database is malformed, matching the T01 known issue.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `memory_query mention formatter-suggestion intent` | 1 | ❌ fail | 0ms |
| 2 | `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-intent.test.ts --timeout 30000` | 1 | ❌ fail | 6560ms |
| 3 | `lsp diagnostics src/handlers/mention.test.ts` | 1 | ❌ fail | 0ms |

## Deviations

T01 showed the exact `@kodiai format suggestions` routing case already passes in current source, so this task pinned the discovered drift/observability boundary rather than duplicating a passing classification-only test.

## Known Issues

The targeted suite is intentionally red until T03 adds the missing structured formatter completion fields. Local GSD memory remains unavailable because the memory database is malformed. LSP diagnostics are unavailable because no language server is running for the edited TypeScript test file.

## Files Created/Modified

- `src/handlers/mention.test.ts`
