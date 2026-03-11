# T02: 03-execution-engine 02

**Slice:** S03 — **Milestone:** M001

## Description

Create three in-process MCP servers that provide GitHub interaction tools to Claude during execution.

Purpose: Claude Code CLI needs tools to post comments, create inline review comments, and read CI status. These are implemented as in-process MCP servers using the Agent SDK's `createSdkMcpServer()` + `tool()` pattern, avoiding the overhead of stdio child processes. Each server receives an Octokit client via closure (not env vars), following the dependency injection pattern established in Phases 1-2.

Output: `src/execution/mcp/comment-server.ts`, `src/execution/mcp/inline-review-server.ts`, `src/execution/mcp/ci-status-server.ts`, `src/execution/mcp/index.ts`

## Must-Haves

- [ ] "Comment server provides update_comment tool that updates a GitHub issue/PR comment via Octokit"
- [ ] "Inline review server provides create_inline_comment tool that posts line-anchored PR review comments"
- [ ] "CI status server provides get_ci_status and get_workflow_run_details tools for reading CI state"
- [ ] "buildMcpServers assembles the correct set of MCP servers based on execution context"

## Files

- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/inline-review-server.ts`
- `src/execution/mcp/ci-status-server.ts`
- `src/execution/mcp/index.ts`
