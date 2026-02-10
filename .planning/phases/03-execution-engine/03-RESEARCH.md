# Phase 3: Execution Engine - Research

**Researched:** 2026-02-07
**Domain:** Claude Agent SDK integration, MCP server implementation, config loading
**Confidence:** HIGH

## Summary

Phase 3 connects the job infrastructure (Phase 2) to Claude Code CLI via the `@anthropic-ai/claude-agent-sdk` package. The SDK provides a `query()` function that spawns a Claude Code CLI process, streams messages back as an async generator, and manages MCP server lifecycle automatically. MCP servers provide GitHub interaction tools (posting comments, inline review comments, reading CI status) that Claude can invoke during execution.

The reference implementation (`tmp/claude-code-action/` and `tmp/claude-code-base-action/`) demonstrates the exact pattern: MCP servers are defined as standalone TypeScript files using `@modelcontextprotocol/sdk`, configured as stdio processes with environment variables for auth, and passed to `query()` via the `mcpServers` option. The SDK handles spawning, connecting, and tearing down MCP servers automatically.

A critical architectural decision: the Agent SDK supports **in-process MCP servers** via `createSdkMcpServer()` (defined with `tool()` helpers, no separate process needed), or **stdio MCP servers** (separate processes launched by the SDK). For kodiai, **in-process MCP servers using `createSdkMcpServer()`** are strongly recommended -- they avoid spawning extra processes, share the same Bun runtime, and have direct access to the Octokit clients already available in the application. The reference code uses stdio servers because it runs in GitHub Actions where the MCP server files must be standalone scripts, but kodiai runs as a long-lived server where in-process is simpler and more efficient.

**Primary recommendation:** Use `createSdkMcpServer()` with `tool()` from the Agent SDK to define GitHub interaction tools as in-process MCP servers, pass them to `query()` alongside a prompt string, the workspace `cwd`, and a `CLAUDE_CODE_OAUTH_TOKEN` environment variable.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | `^0.2.37` | Claude Code CLI invocation via `query()` | Official SDK; the only supported way to invoke Claude Code programmatically |
| `@modelcontextprotocol/sdk` | `^1.11.0` | MCP server/tool type definitions | Official MCP TypeScript SDK; provides types used by Agent SDK |
| `@octokit/rest` | `^22.0.1` | GitHub API calls within MCP tool handlers | Already in project; used for comments, reviews, CI status |
| `zod` | `^4.3.6` | Config schema validation, MCP tool input schemas | Already in project; Agent SDK's `tool()` uses Zod for input schemas |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` | `^10.3.0` | Logging within executor and MCP handlers | Already in project; all modules use it |
| `@octokit/auth-app` | `^8.2.0` | Installation token generation for MCP server auth | Already in project; workspace manager uses it |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-process MCP (`createSdkMcpServer`) | Stdio MCP servers (separate .ts files) | Stdio requires spawning child processes, more complex lifecycle, harder to share app context (Octokit clients, logger). In-process is simpler for a long-lived server. |
| `@modelcontextprotocol/sdk` McpServer class | Agent SDK `tool()` helper | `tool()` is simpler and integrates directly with `createSdkMcpServer()`. Using McpServer class directly is only needed for stdio transport. |
| File-based prompt | Inline string prompt | Reference code writes prompts to files for the GitHub Action flow. Kodiai can pass prompt strings directly to `query()`, which is simpler. |

**Installation:**
```bash
bun install @anthropic-ai/claude-agent-sdk @modelcontextprotocol/sdk
```

Note: `@modelcontextprotocol/sdk` may already be pulled in as a transitive dependency of `@anthropic-ai/claude-agent-sdk`, but listing it explicitly ensures type imports work.

## Architecture Patterns

### Recommended Project Structure
```
src/
  execution/
    executor.ts           # createExecutor() - main query() invocation
    mcp/
      comment-server.ts   # createCommentServer() - in-process MCP for posting comments
      inline-review-server.ts  # createInlineReviewServer() - in-process MCP for inline PR review comments
      ci-status-server.ts # createCIStatusServer() - in-process MCP for CI status
      index.ts            # buildMcpServers() - assembles server config based on event context
    prompt.ts             # buildPrompt() - constructs the prompt string for query()
    config.ts             # loadRepoConfig() - loads .kodiai.yml with defaults
    types.ts              # ExecutionContext, ExecutionResult, RepoConfig types
```

### Pattern 1: Agent SDK query() Invocation
**What:** The `query()` function is an async generator that spawns Claude Code CLI, streams messages, and yields them one at a time. The caller iterates with `for await...of`.
**When to use:** Every time Claude needs to be invoked against a workspace.
**Example:**
```typescript
// Source: Official Agent SDK docs - https://platform.claude.com/docs/en/agent-sdk/typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: promptString,
  options: {
    cwd: workspace.dir,
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 25,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: "You are reviewing a GitHub pull request...",
    },
    mcpServers: {
      github_comment: commentServer,
      github_inline_comment: inlineReviewServer,
      github_ci: ciStatusServer,
    },
    allowedTools: [
      "Read", "Grep", "Glob", "Edit", "Write",
      "Bash(git diff:*)", "Bash(git log:*)", "Bash(git status:*)",
      "mcp__github_comment__*",
      "mcp__github_inline_comment__*",
      "mcp__github_ci__*",
    ],
    disallowedTools: ["WebSearch", "WebFetch"],
    settingSources: ["project"],  // Load CLAUDE.md from repo
    permissionMode: "bypassPermissions",
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    },
  },
});

let resultMessage: SDKResultMessage | undefined;
for await (const message of result) {
  if (message.type === "system" && message.subtype === "init") {
    logger.info({ model: message.model, tools: message.tools }, "Claude initialized");
  }
  if (message.type === "result") {
    resultMessage = message;
  }
}
```

### Pattern 2: In-Process MCP Server via createSdkMcpServer()
**What:** Define MCP tools using `tool()` and bundle them into an in-process server with `createSdkMcpServer()`. No separate process spawned.
**When to use:** For all kodiai MCP servers (comment, inline-review, CI status).
**Example:**
```typescript
// Source: Official Agent SDK docs - https://platform.claude.com/docs/en/agent-sdk/custom-tools
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";

export function createCommentServer(octokit: Octokit, owner: string, repo: string, commentId: number) {
  return createSdkMcpServer({
    name: "github_comment",
    version: "0.1.0",
    tools: [
      tool(
        "update_comment",
        "Update the tracking comment with progress and results",
        {
          body: z.string().describe("The updated comment content (markdown)"),
        },
        async ({ body }) => {
          await octokit.rest.issues.updateComment({
            owner, repo,
            comment_id: commentId,
            body,
          });
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, comment_id: commentId }) }],
          };
        },
      ),
    ],
  });
}
```

### Pattern 3: Config Loading with Defaults
**What:** Load `.kodiai.yml` from the cloned repo, validate with Zod, merge with sensible defaults. If file does not exist, use defaults only.
**When to use:** Before every execution, to determine model, max turns, allowed tools, custom instructions, etc.
**Example:**
```typescript
import { z } from "zod";

const repoConfigSchema = z.object({
  model: z.string().default("claude-sonnet-4-5-20250929"),
  maxTurns: z.number().min(1).max(100).default(25),
  systemPromptAppend: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;

export async function loadRepoConfig(workspaceDir: string): Promise<RepoConfig> {
  const configPath = `${workspaceDir}/.kodiai.yml`;
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return repoConfigSchema.parse({});  // All defaults
  }

  // Parse YAML and validate
  const raw = await file.text();
  // ... yaml parsing + zod validation
}
```

### Pattern 4: Factory Function with Dependency Injection
**What:** All modules export factory functions that accept their dependencies, consistent with Phase 1/2 patterns.
**When to use:** All module exports in this phase.
**Example:**
```typescript
// Consistent with existing codebase pattern
export function createExecutor(deps: {
  githubApp: GitHubApp;
  logger: Logger;
}) {
  return {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
      // ...
    }
  };
}
```

### Anti-Patterns to Avoid
- **Don't use stdio MCP servers:** The reference code uses stdio (separate processes) because it runs in GitHub Actions. Kodiai is a long-lived server -- use in-process MCP servers via `createSdkMcpServer()` instead.
- **Don't pass MCP config as JSON string via `--mcp-config`:** The reference code uses `extraArgs["mcp-config"]` because it wraps CLI flags. The SDK's `mcpServers` option is the correct way to pass MCP config programmatically.
- **Don't write prompt to file:** The reference code writes prompts to temporary files because GitHub Actions requires it. Kodiai can pass prompt strings directly to `query()`.
- **Don't hardcode environment variable reads in MCP tools:** In the reference code, MCP servers read `process.env.GITHUB_TOKEN` because they run as separate processes. In-process servers should receive Octokit clients via closure/dependency injection.
- **Don't use `process.env` for Claude auth in production:** Set `CLAUDE_CODE_OAUTH_TOKEN` in the `env` option of `query()`, not globally on `process.env`, to prevent token leakage to unrelated processes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Claude Code CLI invocation | Custom child_process spawn | `query()` from `@anthropic-ai/claude-agent-sdk` | Handles CLI lifecycle, message streaming, MCP server management, retries |
| MCP server protocol | Custom stdio/JSON-RPC implementation | `createSdkMcpServer()` + `tool()` | Handles protocol, serialization, tool discovery, error formatting |
| MCP tool input validation | Manual argument checking | Zod schemas via `tool()` | Type-safe, auto-generates JSON schema for tool discovery |
| YAML parsing | Custom parser | `js-yaml` or Bun's built-in | Well-tested edge cases (multi-line strings, anchors, etc.) |
| Content sanitization | Custom regex per token type | Port sanitizer from reference code | Reference code handles GitHub tokens, invisible chars, HTML comments, markdown injection |

**Key insight:** The Agent SDK manages the entire Claude Code CLI lifecycle -- spawning the process, connecting MCP servers, streaming messages, handling errors, and cleanup. Trying to invoke the CLI directly (e.g., via `Bun.$`) would bypass all of this.

## Common Pitfalls

### Pitfall 1: MCP Tool Permission Denied
**What goes wrong:** Claude sees MCP tools but cannot call them, returning "permission denied" errors.
**Why it happens:** MCP tools require explicit listing in `allowedTools`. Without this, Claude can discover tools but not use them.
**How to avoid:** Always include `mcp__<server_name>__*` or specific tool names in `allowedTools` when configuring MCP servers.
**Warning signs:** `permission_denials` array in the result message is non-empty.

### Pitfall 2: Missing settingSources for CLAUDE.md
**What goes wrong:** Claude ignores the repo's CLAUDE.md file during execution.
**Why it happens:** The SDK defaults to `settingSources: []` (no filesystem settings loaded). Without `settingSources: ["project"]`, CLAUDE.md files are not loaded.
**How to avoid:** Include `settingSources: ["project"]` in the query options. Also requires `systemPrompt: { type: "preset", preset: "claude_code" }` to actually use CLAUDE.md content.
**Warning signs:** Claude doesn't follow repo-specific conventions documented in CLAUDE.md.

### Pitfall 3: OAuth Token Not Reaching Claude Code
**What goes wrong:** Claude Code fails to authenticate with the Anthropic API.
**Why it happens:** The `CLAUDE_CODE_OAUTH_TOKEN` environment variable must be set in the `env` option passed to `query()`, not just in `process.env`. The SDK spawns a child process with the specified env.
**How to avoid:** Always pass auth credentials via `options.env` in the `query()` call: `env: { CLAUDE_CODE_OAUTH_TOKEN: token }`.
**Warning signs:** "Authentication failed" or "API key required" errors from the CLI subprocess.

### Pitfall 4: MCP Server Name Collision
**What goes wrong:** Two MCP servers with the same name cause one to be overwritten silently.
**Why it happens:** `mcpServers` is a `Record<string, McpServerConfig>` -- duplicate keys overwrite.
**How to avoid:** Use distinct, descriptive server names: `github_comment`, `github_inline_comment`, `github_ci`.
**Warning signs:** Expected MCP tools are missing from the `system.init` message.

### Pitfall 5: Excessive maxTurns Causing Runaway Costs
**What goes wrong:** Claude enters long loops, consuming excessive API credits.
**Why it happens:** Without `maxTurns` or `maxBudgetUsd`, Claude can run indefinitely.
**How to avoid:** Always set `maxTurns` (e.g., 25) and optionally `maxBudgetUsd` as safety limits.
**Warning signs:** Result message shows `subtype: "error_max_turns"` or unexpectedly high `total_cost_usd`.

### Pitfall 6: Octokit Client Not Refreshed for Long-Running Jobs
**What goes wrong:** GitHub API calls fail with 401 during long Claude executions.
**Why it happens:** Installation tokens expire after 1 hour. If a job runs longer, the token in the Octokit client becomes invalid.
**How to avoid:** For in-process MCP servers, create fresh Octokit clients per API call or use `getInstallationOctokit()` which handles token refresh internally (auth-app caches and refreshes). Do NOT create a single Octokit instance at MCP server creation time and reuse it for all calls.
**Warning signs:** 401 errors from GitHub API mid-execution.

### Pitfall 7: Forgetting bypassPermissions for Headless Execution
**What goes wrong:** Claude prompts for permission to use tools, which hangs the headless execution.
**Why it happens:** Default `permissionMode` is `"default"`, which requires user approval for tool use.
**How to avoid:** Set `permissionMode: "bypassPermissions"` for headless/automated execution. This is safe because `allowedTools` already constrains what Claude can do.
**Warning signs:** Execution hangs indefinitely, no result message received.

## Code Examples

Verified patterns from official sources and reference implementation:

### Complete Executor Factory
```typescript
// Based on reference: tmp/claude-code-base-action/src/run-claude-sdk.ts
// and official docs: https://platform.claude.com/docs/en/agent-sdk/typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

export type ExecutionResult = {
  conclusion: "success" | "failure";
  costUsd?: number;
  numTurns?: number;
  durationMs?: number;
  sessionId?: string;
};

export function createExecutor(logger: Logger) {
  return {
    async execute(opts: {
      prompt: string;
      cwd: string;
      mcpServers: Record<string, any>;
      allowedTools: string[];
      model?: string;
      maxTurns?: number;
      systemPromptAppend?: string;
    }): Promise<ExecutionResult> {
      const sdkQuery = query({
        prompt: opts.prompt,
        options: {
          cwd: opts.cwd,
          model: opts.model ?? "claude-sonnet-4-5-20250929",
          maxTurns: opts.maxTurns ?? 25,
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            ...(opts.systemPromptAppend && { append: opts.systemPromptAppend }),
          },
          mcpServers: opts.mcpServers,
          allowedTools: opts.allowedTools,
          disallowedTools: ["WebSearch", "WebFetch"],
          settingSources: ["project"],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          env: {
            ...process.env,
            CLAUDE_CODE_ENTRYPOINT: "kodiai-github-app",
          },
        },
      });

      let resultMessage: SDKResultMessage | undefined;

      for await (const message of sdkQuery) {
        if (message.type === "system" && message.subtype === "init") {
          logger.info({ model: (message as any).model }, "Claude Code initialized");
        }
        if (message.type === "result") {
          resultMessage = message as SDKResultMessage;
        }
      }

      if (!resultMessage) {
        throw new Error("No result message received from Claude Code");
      }

      return {
        conclusion: resultMessage.subtype === "success" ? "success" : "failure",
        costUsd: resultMessage.total_cost_usd,
        numTurns: resultMessage.num_turns,
        durationMs: resultMessage.duration_ms,
        sessionId: resultMessage.session_id,
      };
    },
  };
}
```

### In-Process MCP Server for Inline Review Comments
```typescript
// Ported from reference: tmp/claude-code-action/src/mcp/github-inline-comment-server.ts
// Adapted to use createSdkMcpServer() instead of stdio transport
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";

export function createInlineReviewServer(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
) {
  return createSdkMcpServer({
    name: "github_inline_comment",
    version: "0.1.0",
    tools: [
      tool(
        "create_inline_comment",
        "Create an inline comment on a specific line or lines in a PR file",
        {
          path: z.string().describe("File path to comment on (e.g., 'src/index.ts')"),
          body: z.string().describe("Comment text (supports markdown and suggestion blocks)"),
          line: z.number().nonnegative().optional()
            .describe("Line number for single-line comment"),
          startLine: z.number().nonnegative().optional()
            .describe("Start line for multi-line comment (use with line for end)"),
          side: z.enum(["LEFT", "RIGHT"]).optional().default("RIGHT")
            .describe("Side of diff: LEFT (old code) or RIGHT (new code)"),
        },
        async ({ path, body, line, startLine, side }) => {
          const pr = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
          const params: any = {
            owner, repo,
            pull_number: prNumber,
            body, path,
            side: side || "RIGHT",
            commit_id: pr.data.head.sha,
          };

          if (startLine) {
            params.start_line = startLine;
            params.start_side = side || "RIGHT";
            params.line = line;
          } else {
            params.line = line;
          }

          const result = await octokit.rest.pulls.createReviewComment(params);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                comment_id: result.data.id,
                html_url: result.data.html_url,
              }),
            }],
          };
        },
      ),
    ],
  });
}
```

### Config Loader with Defaults
```typescript
import { z } from "zod";

const repoConfigSchema = z.object({
  model: z.string().default("claude-sonnet-4-5-20250929"),
  maxTurns: z.number().min(1).max(100).default(25),
  systemPromptAppend: z.string().optional(),
  review: z.object({
    enabled: z.boolean().default(true),
    autoApprove: z.boolean().default(false),
  }).default({}),
  mention: z.object({
    enabled: z.boolean().default(true),
  }).default({}),
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;

export async function loadRepoConfig(workspaceDir: string): Promise<RepoConfig> {
  const configPath = `${workspaceDir}/.kodiai.yml`;
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return repoConfigSchema.parse({});
  }

  const raw = await file.text();
  // YAML parsing needed here -- see "Open Questions" section
  const parsed = parseYaml(raw);  // placeholder
  return repoConfigSchema.parse(parsed);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Shell out to `claude` CLI directly | Use `query()` from Agent SDK | Agent SDK v0.1.0+ (2025) | Structured message streaming, MCP support, type safety |
| Stdio MCP servers only | In-process MCP via `createSdkMcpServer()` | Agent SDK v0.2.x (2025) | No child process overhead, simpler lifecycle |
| `ANTHROPIC_API_KEY` only | `CLAUDE_CODE_OAUTH_TOKEN` (Claude Max) + API key | 2025 | OAuth token is the auth path for kodiai v1 |
| Permission prompts in headless mode | `permissionMode: "bypassPermissions"` | Agent SDK v0.1.x | Required for automated/headless operation |
| No setting source control | `settingSources` option | Agent SDK v0.2.x | Explicit control over which filesystem settings are loaded |

**Deprecated/outdated:**
- Using `--mcp-config` CLI flag via `extraArgs`: Use `mcpServers` option directly instead
- Writing prompt to file then passing file path: Pass prompt string directly to `query()`
- `@actions/core` for env var management: Only relevant in GitHub Actions context

## Open Questions

1. **YAML Parsing Library**
   - What we know: `.kodiai.yml` needs YAML parsing. Bun does not have built-in YAML parsing.
   - What's unclear: Whether to use `js-yaml`, `yaml`, or another library. The config is simple enough that JSON could work too (`.kodiai.json`).
   - Recommendation: Use `js-yaml` (most popular, well-tested) or support both `.kodiai.yml` and `.kodiai.json`. The config schema is simple enough that either format works. If we want zero dependencies, support only `.kodiai.json` initially.

2. **Claude Code CLI Installation**
   - What we know: The Agent SDK requires the Claude Code CLI binary to be available. The reference code installs it via `npm install -g @anthropic-ai/claude-code`.
   - What's unclear: Whether the CLI is bundled with the Agent SDK package or must be installed separately in the Docker container.
   - Recommendation: The Docker image (Phase 8) must include `@anthropic-ai/claude-code` globally installed. For development, ensure it's installed: `bun install -g @anthropic-ai/claude-code`. The `pathToClaudeCodeExecutable` option can point to a specific path if needed.

3. **In-Process MCP Server Compatibility with Bun**
   - What we know: The Agent SDK's `createSdkMcpServer()` returns a `McpSdkServerConfigWithInstance` that the SDK communicates with in-process. The SDK is tested with Node.js and Bun.
   - What's unclear: Whether `createSdkMcpServer()` works perfectly with Bun runtime. The reference code uses stdio servers (which are runtime-agnostic).
   - Recommendation: Start with in-process MCP servers. If issues arise, fall back to stdio servers (standalone .ts files run via `bun run`). The stdio approach is proven in the reference code.

4. **OAuth Token Rotation**
   - What we know: Kodiai v1 uses `CLAUDE_CODE_OAUTH_TOKEN` (Claude Max). This is set once as an environment variable.
   - What's unclear: Whether the token expires and needs rotation, or if it's long-lived.
   - Recommendation: Treat as a static env var for v1. Token rotation can be added later if needed.

## Sources

### Primary (HIGH confidence)
- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) - Complete Options type, query() API, SDKMessage types, McpServerConfig types
- [Agent SDK MCP Documentation](https://platform.claude.com/docs/en/agent-sdk/mcp) - MCP server configuration, tool permissions, authentication, error handling
- [Agent SDK Custom Tools](https://platform.claude.com/docs/en/agent-sdk/custom-tools) - createSdkMcpServer(), tool() helper, in-process MCP servers
- Reference code: `tmp/claude-code-action/src/mcp/` - Working MCP server implementations for GitHub comment, inline comment, CI status, file ops
- Reference code: `tmp/claude-code-base-action/src/run-claude-sdk.ts` - Working query() invocation with message streaming and result extraction
- Reference code: `tmp/claude-code-base-action/src/parse-sdk-options.ts` - Complete Options construction with MCP config merging

### Secondary (MEDIUM confidence)
- [@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) - Package exists at version ^0.2.37
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) - Package exists at version ^1.11.0

### Tertiary (LOW confidence)
- YAML parsing approach - No verification of `js-yaml` compatibility with Bun (likely fine, but untested)
- `createSdkMcpServer()` with Bun - No direct evidence of Bun-specific testing (SDK docs mention Node.js and Bun support broadly)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Versions confirmed from reference code package.json, API verified from official docs
- Architecture: HIGH - Patterns directly ported from working reference implementation, adapted for long-lived server context
- Pitfalls: HIGH - Derived from official docs (permissionMode, settingSources, allowedTools) and reference code patterns (token lifecycle, env passing)
- Config loading: MEDIUM - Config schema is our design; YAML parsing library choice is open

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (Agent SDK is evolving; check for breaking changes in minor versions)
