# 03-02 Summary: MCP Servers

**Status:** Complete
**Duration:** ~3min
**Files created:** `src/execution/mcp/comment-server.ts`, `src/execution/mcp/inline-review-server.ts`, `src/execution/mcp/ci-status-server.ts`, `src/execution/mcp/index.ts`

## What Was Built

1. **Comment server** (`comment-server.ts`) -- `createCommentServer(getOctokit, owner, repo)` with `update_comment` tool for updating GitHub issue/PR comments.

2. **Inline review server** (`inline-review-server.ts`) -- `createInlineReviewServer(getOctokit, owner, repo, prNumber)` with `create_inline_comment` tool for posting line-anchored PR review comments (single and multi-line).

3. **CI status server** (`ci-status-server.ts`) -- `createCIStatusServer(getOctokit, owner, repo, prNumber)` with `get_ci_status` and `get_workflow_run_details` tools.

4. **MCP assembler** (`index.ts`) -- `buildMcpServers(deps)` assembles context-appropriate servers (all 3 for PRs, comment-only for issues). `buildAllowedMcpTools(serverNames)` generates `mcp__<name>__*` patterns.

## Key Decisions

- All servers use `getOctokit: () => Promise<Octokit>` for fresh client per API call (Pitfall 6 prevention).
- In-process MCP servers via `createSdkMcpServer()` + `tool()` pattern -- no child processes.
- `download_job_log` not ported (GitHub Actions specific).
- Helpful error messages for "Validation Failed" and "Not Found" on inline comments.

## Dependencies Installed

- `@anthropic-ai/claude-agent-sdk@0.2.37`
- `@modelcontextprotocol/sdk@1.26.0`
