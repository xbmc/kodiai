---
id: S02
parent: M021
milestone: M021
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 
verification_result: passed
completed_at: 2026-02-26
blocker_discovered: false
---
# S02: Issue Mcp Tools

**# Plan 01 Summary: github_issue_label MCP Tool**

## What Happened

# Plan 01 Summary: github_issue_label MCP Tool

## What Was Built
`createIssueLabelServer` factory function implementing the `add_labels` MCP tool with:
- Label pre-validation against repo's label list (case-insensitive matching)
- Partial application: valid labels applied, invalid reported separately
- Closed issue warning (labels still applied)
- Rate limit retry with exponential backoff
- Config gating via `getTriageConfig()` (hot-reload support)
- Structured error codes: TOOL_DISABLED, LABEL_NOT_FOUND, ISSUE_NOT_FOUND, PERMISSION_DENIED

## Key Files

### Created
- `src/execution/mcp/issue-label-server.ts` -- MCP server factory
- `src/execution/mcp/issue-label-server.test.ts` -- 11 unit tests

## Test Results
11/11 tests passing

## Commits
- `feat(104-01): implement github_issue_label MCP tool with TDD (11/11 tests pass)`

## Self-Check: PASSED
- [x] Factory exported with correct signature
- [x] All test cases pass
- [x] Handles all error codes from CONTEXT.md
- [x] Partial application semantics implemented
- [x] Case-insensitive label matching

# Plan 02 Summary: github_issue_comment MCP Tool

## What Was Built
`createIssueCommentServer` factory function implementing `create_comment` and `update_comment` MCP tools with:
- Raw markdown and structured input (title/body/suggestions)
- Comment update by ID
- Max length enforcement (60000 chars) with truncation note
- No bot branding or signature
- Closed issue warning
- Rate limit retry with exponential backoff
- Config gating via `getTriageConfig()` (hot-reload support)
- Structured error codes: TOOL_DISABLED, ISSUE_NOT_FOUND, COMMENT_NOT_FOUND, PERMISSION_DENIED

## Key Files

### Created
- `src/execution/mcp/issue-comment-server.ts` -- MCP server factory
- `src/execution/mcp/issue-comment-server.test.ts` -- 13 unit tests

## Test Results
13/13 tests passing

## Commits
- `feat(104-02): implement github_issue_comment MCP tool with TDD (13/13 tests pass)`

## Self-Check: PASSED
- [x] Both tools (create + update) exported
- [x] All test cases pass
- [x] Structured input formatted correctly
- [x] No bot branding in output
- [x] Max length truncation works

# Plan 03 Summary: Config Gating & Registry Wiring

## What Was Built
- `triage` section added to `.kodiai.yml` schema with `enabled` (default false), `label.enabled`, `comment.enabled`
- Both issue MCP tools wired into `buildMcpServers()` via `enableIssueTools` + `triageConfig` deps
- Section fallback parsing for graceful config error handling
- Integration tests verifying wiring behavior

## Key Files

### Modified
- `src/execution/config.ts` -- Added `triageSchema` and section fallback
- `src/execution/mcp/index.ts` -- Added issue tool imports, exports, and registration

### Created
- `src/execution/mcp/index.test.ts` -- 7 integration tests

## Test Results
- Config: 79/79 tests passing
- MCP: 102/102 tests passing (all servers)

## Commits
- `feat(104-03): wire issue MCP tools into executor registry with config gating (102/102 MCP tests pass)`

## Self-Check: PASSED
- [x] Triage config schema added
- [x] Section fallback parsing handles invalid config
- [x] Both tools registered when enabled
- [x] Not registered by default (opt-in)
- [x] Existing tools unaffected
- [x] Integration tests pass
