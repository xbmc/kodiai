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
