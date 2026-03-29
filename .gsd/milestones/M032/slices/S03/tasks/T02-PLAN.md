---
estimated_steps: 14
estimated_files: 2
skills_used: []
---

# T02: Agent job entrypoint script

Create src/execution/agent-entrypoint.ts — the script the ACA Job container runs.

Responsibilities:
1. Read required env vars: WORKSPACE_DIR, MCP_BASE_URL, MCP_BEARER_TOKEN, ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN as fallback). Exit 1 with a clear message if any required var is missing.
2. Read agent-config.json from WORKSPACE_DIR. Shape: { prompt: string, model: string, maxTurns: number, allowedTools: string[], taskType?: string }. Exit 1 if file is missing or JSON is invalid.
3. Write CLAUDE.md to WORKSPACE_DIR by calling buildSecurityClaudeMd() (imported from ./executor.ts).
4. Build mcpServers as McpHttpServerConfig entries — one for each of the 7 server names (github_comment, reviewCommentThread, github_inline_comment, github_ci, review_checkpoint, github_issue_label, github_issue_comment). All point at `${MCP_BASE_URL}/internal/mcp/${serverName}` with `Authorization: Bearer ${MCP_BEARER_TOKEN}` header.
5. Call query() from @anthropic-ai/claude-agent-sdk with: prompt from agent-config.json, model from agent-config.json, maxTurns from agent-config.json, allowedTools from agent-config.json, mcpServers object, cwd: WORKSPACE_DIR, permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, settingSources: ['project'].
6. Collect messages from the async iterator. Capture the SDKResultMessage when message.type === 'result'.
7. Write result.json to WORKSPACE_DIR with the ExecutionResult shape: { conclusion, costUsd, numTurns, durationMs, sessionId, resultText, model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, stopReason }. On any error, write { conclusion: 'error', errorMessage: string }.

Create src/execution/agent-entrypoint.test.ts with tests:
- Missing env vars → console.error + process.exit(1) (spy on process.exit)
- Missing agent-config.json → exits with error
- Happy path: mock query() to yield one result message → result.json written with conclusion: 'success'
- SDK iterator throws → result.json written with conclusion: 'error'

## Inputs

- ``src/execution/executor.ts` — import buildSecurityClaudeMd()`
- ``src/execution/types.ts` — ExecutionResult shape to write to result.json`
- ``src/jobs/aca-launcher.ts` — T01 must be complete (config fields used for defaults)`

## Expected Output

- ``src/execution/agent-entrypoint.ts` — new file, the ACA job container script`
- ``src/execution/agent-entrypoint.test.ts` — unit tests for happy path and error paths`

## Verification

bun test ./src/execution/agent-entrypoint.test.ts && bun run tsc --noEmit
