# T01: 03-execution-engine 01

**Slice:** S03 — **Milestone:** M001

## Description

Define the execution type system and config loader for Phase 3.

Purpose: Establish the shared types (ExecutionContext, ExecutionResult, RepoConfig) used by the executor and MCP servers, and implement the config loader that reads `.kodiai.yml` from cloned repos with full defaults for zero-config operation.

Output: `src/execution/types.ts` and `src/execution/config.ts`

## Must-Haves

- [ ] "loadRepoConfig returns validated config with sensible defaults when .kodiai.yml does not exist"
- [ ] "loadRepoConfig reads and validates .kodiai.yml when it exists in the workspace"
- [ ] "Invalid .kodiai.yml values are rejected with clear Zod validation errors"
- [ ] "ExecutionContext and ExecutionResult types are defined for use by executor and MCP servers"

## Files

- `src/execution/types.ts`
- `src/execution/config.ts`
