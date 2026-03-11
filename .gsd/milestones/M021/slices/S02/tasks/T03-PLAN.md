# T03: 104-issue-mcp-tools 03

**Slice:** S02 — **Milestone:** M021

## Description

Wire both issue MCP tools into the executor MCP server registry with config gating and integration tests.

Purpose: Make the issue label and comment tools available to the triage agent, controlled by per-repo `.kodiai.yml` configuration.
Output: Updated `index.ts` registry, `config.ts` schema, integration tests.

## Must-Haves

- [ ] "Both issue MCP tools are registered in the executor MCP server registry"
- [ ] "Triage config section in .kodiai.yml controls tool availability"
- [ ] "Config gating is per-repo via triage.label.enabled and triage.comment.enabled"
- [ ] "Integration tests verify wiring from config to MCP server registration"

## Files

- `src/execution/mcp/index.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/execution/mcp/index.test.ts`
