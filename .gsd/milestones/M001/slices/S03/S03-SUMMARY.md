---
id: S03
parent: M001
milestone: M001
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
completed_at: 
blocker_discovered: false
---
# S03: Execution Engine

**# 03-01 Summary: Execution Types and Config Loader**

## What Happened

# 03-01 Summary: Execution Types and Config Loader

**Status:** Complete
**Duration:** ~3min
**Files created:** `src/execution/types.ts`, `src/execution/config.ts`, `src/execution/config.test.ts`

## What Was Built

1. **ExecutionContext type** (`src/execution/types.ts`) -- all fields needed to invoke Claude against a workspace: workspace, installationId, owner, repo, prNumber, commentId, eventType, triggerBody.

2. **ExecutionResult type** (`src/execution/types.ts`) -- outcome of a Claude execution: conclusion (success/failure/error), costUsd, numTurns, durationMs, sessionId, errorMessage.

3. **loadRepoConfig** (`src/execution/config.ts`) -- loads `.kodiai.yml` from cloned repo with Zod validation and full defaults for zero-config operation.

## Key Decisions

- Zod v4 `.default()` on nested objects requires the full default value (not `{}`) -- fixed during implementation.
- `js-yaml` used for YAML parsing with explicit error messages for parse and validation failures.
- RepoConfig re-exported from types.ts via `export type { RepoConfig }`.

## Defaults

| Setting | Default |
|---------|---------|
| model | claude-sonnet-4-5-20250929 |
| maxTurns | 25 |
| review.enabled | true |
| review.autoApprove | false |
| mention.enabled | true |

## Test Results

4/4 tests passing: defaults when no file, reads valid YAML, rejects invalid YAML, rejects invalid values.

# 03-03 Summary: Executor and Prompt Builder

**Status:** Complete
**Duration:** ~3min
**Files created:** `src/execution/prompt.ts`, `src/execution/executor.ts`

## What Was Built

1. **Prompt builder** (`prompt.ts`) -- `buildPrompt(context)` constructs the text prompt from event type, repo info, PR number, and trigger body. Intentionally simple scaffold for Phase 3; Phase 4/5 will extend.

2. **Executor** (`executor.ts`) -- `createExecutor({ githubApp, logger })` returns `{ execute(context): Promise<ExecutionResult> }`. The execute method:
   - Loads repo config from workspace
   - Builds MCP servers with fresh Octokit per call
   - Constructs allowed tools (read-only base tools + MCP tools)
   - Invokes `query()` from Agent SDK with prompt, cwd, model, MCP servers
   - Streams messages and extracts result
   - Returns structured ExecutionResult (never throws)

## Key Decisions

- `permissionMode: "bypassPermissions"` with `allowDangerouslySkipPermissions: true` for headless execution (Pitfall 7).
- `settingSources: ["project"]` to load repo's CLAUDE.md (Pitfall 2).
- `env: { ...process.env }` passes CLAUDE_CODE_OAUTH_TOKEN through (Pitfall 3).
- Read-only tools for now (no Edit, Write) -- Phase 5 will add write tools for mentions.
- `disallowedTools: ["WebSearch", "WebFetch"]` prevents external web access.
- Executor catches all errors and returns `conclusion: "error"` -- never crashes the server.

## Pitfalls Addressed

| Pitfall | How Addressed |
|---------|--------------|
| 1: MCP tool permission denied | MCP tools included in allowedTools via `mcp__<name>__*` |
| 2: Missing CLAUDE.md | `settingSources: ["project"]` |
| 3: OAuth token | `env: { ...process.env }` passthrough |
| 6: Stale Octokit | `getOctokit()` function, not cached instance |
| 7: Permission prompts | `bypassPermissions` mode |

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
