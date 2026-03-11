# S03: Execution Engine

**Goal:** Define the execution type system and config loader for Phase 3.
**Demo:** Define the execution type system and config loader for Phase 3.

## Must-Haves


## Tasks

- [x] **T01: 03-execution-engine 01**
  - Define the execution type system and config loader for Phase 3.

Purpose: Establish the shared types (ExecutionContext, ExecutionResult, RepoConfig) used by the executor and MCP servers, and implement the config loader that reads `.kodiai.yml` from cloned repos with full defaults for zero-config operation.

Output: `src/execution/types.ts` and `src/execution/config.ts`
- [x] **T02: 03-execution-engine 02**
  - Create three in-process MCP servers that provide GitHub interaction tools to Claude during execution.

Purpose: Claude Code CLI needs tools to post comments, create inline review comments, and read CI status. These are implemented as in-process MCP servers using the Agent SDK's `createSdkMcpServer()` + `tool()` pattern, avoiding the overhead of stdio child processes. Each server receives an Octokit client via closure (not env vars), following the dependency injection pattern established in Phases 1-2.

Output: `src/execution/mcp/comment-server.ts`, `src/execution/mcp/inline-review-server.ts`, `src/execution/mcp/ci-status-server.ts`, `src/execution/mcp/index.ts`
- [x] **T03: 03-execution-engine 03**
  - Create the executor that ties together config, MCP servers, and Claude Code CLI invocation via the Agent SDK.

Purpose: This is the core of Phase 3 -- the `createExecutor()` factory produces an `execute()` method that loads repo config, assembles MCP servers, builds a prompt, and invokes `query()` to run Claude Code against the workspace. It returns a structured `ExecutionResult` that downstream handlers (Phase 4, 5) will use.

Output: `src/execution/executor.ts` and `src/execution/prompt.ts`

## Files Likely Touched

- `src/execution/types.ts`
- `src/execution/config.ts`
- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/inline-review-server.ts`
- `src/execution/mcp/ci-status-server.ts`
- `src/execution/mcp/index.ts`
- `src/execution/executor.ts`
- `src/execution/prompt.ts`
