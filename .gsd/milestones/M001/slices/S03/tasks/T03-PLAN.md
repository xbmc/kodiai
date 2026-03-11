# T03: 03-execution-engine 03

**Slice:** S03 — **Milestone:** M001

## Description

Create the executor that ties together config, MCP servers, and Claude Code CLI invocation via the Agent SDK.

Purpose: This is the core of Phase 3 -- the `createExecutor()` factory produces an `execute()` method that loads repo config, assembles MCP servers, builds a prompt, and invokes `query()` to run Claude Code against the workspace. It returns a structured `ExecutionResult` that downstream handlers (Phase 4, 5) will use.

Output: `src/execution/executor.ts` and `src/execution/prompt.ts`

## Must-Haves

- [ ] "The executor invokes Claude Code CLI via query() with prompt, MCP servers, cwd, model, and auth"
- [ ] "The executor streams messages from query() and returns a structured ExecutionResult"
- [ ] "The prompt builder constructs a context-rich prompt from the execution context"
- [ ] "CLAUDE_CODE_OAUTH_TOKEN is passed via options.env, not process.env (Pitfall 3)"
- [ ] "permissionMode is set to bypassPermissions for headless execution (Pitfall 7)"
- [ ] "settingSources includes 'project' so repo CLAUDE.md is loaded (Pitfall 2)"

## Files

- `src/execution/executor.ts`
- `src/execution/prompt.ts`
