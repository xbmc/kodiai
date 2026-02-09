---
phase: 03-execution-engine
verified: 2026-02-09T16:52:10Z
status: human_needed
score: 6/6 must-haves verified
human_verification:
  - test: "Run a real executor invocation against a cloned repo"
    expected: "Agent SDK query() starts, streams, and returns a result (success/failure) without throwing; cwd points at workspace"
    why_human: "Requires Claude Code CLI + valid CLAUDE_CODE_OAUTH_TOKEN; not verifiable via static analysis"
  - test: "Confirm MCP tools are usable during execution"
    expected: "Claude can call mcp__github_comment__* and (for PRs) mcp__github_inline_comment__* + mcp__github_ci__*; tool calls succeed against GitHub"
    why_human: "Requires live GitHub API access and a real PR/issue context"
---

# Phase 3: Execution Engine Verification Report

**Phase Goal:** The system can invoke Claude Code CLI against a workspace with MCP servers providing GitHub interaction tools, using sensible defaults when no per-repo config exists.
**Verified:** 2026-02-09T16:52:10Z
**Status:** human_needed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Claude Code CLI is invoked via Agent SDK `query()` with a prompt, MCP servers, and `cwd` pointing to the workspace | VERIFIED | `src/execution/executor.ts` passes `prompt`, `options.cwd = context.workspace.dir`, `mcpServers`, `model`, `maxTurns` into `query()` |
| 2 | MCP servers for comments, inline review comments, and CI status are available to the CLI during execution | VERIFIED | `src/execution/mcp/index.ts` assembles `github_comment` always and `github_inline_comment` + `github_ci` when `prNumber` exists; `src/execution/executor.ts` includes `buildAllowedMcpTools(Object.keys(mcpServers))` in `allowedTools` |
| 3 | Zero-config works: defaults apply when `.kodiai.yml` is missing | VERIFIED | `src/execution/config.ts` returns `repoConfigSchema.parse({})` when `Bun.file(...).exists()` is false; `src/execution/config.test.ts` asserts defaults |
| 4 | Invalid `.kodiai.yml` is rejected with clear errors (YAML parse + Zod validation) | VERIFIED | `src/execution/config.ts` throws `Invalid .kodiai.yml: YAML parse error: ...` and formats Zod issues into `Invalid .kodiai.yml: path: message`; tests cover both cases |
| 5 | Headless execution pitfalls are addressed: permissions bypass + repo CLAUDE.md loaded + OAuth token passed via `options.env` | VERIFIED | `src/execution/executor.ts` sets `permissionMode: "bypassPermissions"`, `settingSources: ["project"]`, and passes `env: { ...process.env, ... }` into query options |
| 6 | Execution engine is wired into the running server and handlers can use it | VERIFIED | `src/index.ts` constructs `const executor = createExecutor({ githubApp, logger })` and passes it to `createReviewHandler` and `createMentionHandler` |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---------|----------|--------|---------|
| `src/execution/types.ts` | ExecutionContext / ExecutionResult types exported | VERIFIED | Exports both; used by executor + prompt builders |
| `src/execution/config.ts` | `.kodiai.yml` loader with defaults + Zod validation | VERIFIED | Uses `Bun.file().exists()/text()`, `js-yaml`, and Zod schema defaults |
| `src/execution/mcp/comment-server.ts` | In-process MCP server for GitHub comments | VERIFIED | Implements `update_comment` (and `create_comment`) using Octokit per call |
| `src/execution/mcp/inline-review-server.ts` | In-process MCP server for inline review comments | VERIFIED | Implements `create_inline_comment` using `octokit.rest.pulls.createReviewComment` and PR head sha |
| `src/execution/mcp/ci-status-server.ts` | In-process MCP server for CI status | VERIFIED | Implements `get_ci_status` + `get_workflow_run_details` using `octokit.rest.actions.*` |
| `src/execution/mcp/index.ts` | MCP server assembly + allowedTools pattern helper | VERIFIED | `buildMcpServers()` + `buildAllowedMcpTools()` exported; conditional PR-only servers |
| `src/execution/executor.ts` | Executor calling Agent SDK query() and returning structured results | VERIFIED | Loads repo config, builds servers, builds prompt, streams messages, returns `ExecutionResult` |
| `src/execution/prompt.ts` | Prompt builder scaffold | VERIFIED | Builds context-rich prompt; sanitizes trigger body |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/execution/executor.ts` | `@anthropic-ai/claude-agent-sdk` | `query()` invocation | WIRED | Imports `query` and calls it with `options.cwd/model/maxTurns/mcpServers/allowedTools` |
| `src/execution/executor.ts` | `src/execution/config.ts` | `loadRepoConfig()` | WIRED | Loads `.kodiai.yml` from workspace and uses returned `model/maxTurns/timeoutSeconds` |
| `src/execution/executor.ts` | `src/execution/mcp/index.ts` | `buildMcpServers()` + `buildAllowedMcpTools()` | WIRED | MCP servers passed to `query()`; tool patterns included in `allowedTools` |
| `src/execution/mcp/*` | GitHub API (Octokit) | `octokit.rest.*` calls | WIRED | Comment: `issues.updateComment`; Inline: `pulls.createReviewComment`; CI: `actions.listWorkflowRunsForRepo/listJobsForWorkflowRun` |
| `src/execution/config.ts` | Bun + YAML + Zod | `Bun.file` + `yaml.load` + schema parse | WIRED | Defaults returned when missing; errors thrown on YAML/Zod failures |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|------------|--------|----------------|
| `EXEC-03` | SATISFIED | None found in code-level verification |
| `EXEC-04` | SATISFIED | None found in code-level verification |
| `OPS-03` | SATISFIED | None found in code-level verification |

### Anti-Patterns Found

No obvious stubs detected in `src/execution/**` (no placeholder returns, TODO-only handlers, or console-only implementations observed in the core execution engine files).

### Human Verification Required

### 1. Real Claude CLI Invocation

**Test:** Trigger a review/mention on an installed repo so the job queue runs `executor.execute()`.
**Expected:** Query starts, produces streamed messages, and returns an `ExecutionResult` (and the job posts expected GitHub output).
**Why human:** Requires real Claude Code CLI runtime + OAuth token and cannot be validated by static code inspection.

### 2. MCP Tool Availability

**Test:** In a PR context, confirm Claude can call `mcp__github_inline_comment__*` and `mcp__github_ci__*` (and always `mcp__github_comment__*`).
**Expected:** Tool calls succeed against GitHub and result in real comments/status reads.
**Why human:** Requires live GitHub API calls and a real PR diff; not testable offline in this verification pass.

---

_Verified: 2026-02-09T16:52:10Z_
_Verifier: Claude (gsd-verifier)_
