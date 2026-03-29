# S03: Agent Job Entrypoint + Executor Refactor

**Goal:** Wire S01 (ACA launcher) and S02 (MCP HTTP registry) into the orchestrator's execution path: add the agent job container entrypoint script, refactor createExecutor() to dispatch ACA jobs instead of running the SDK in-process, and add the supporting config fields, cancel helper, and Dockerfile.
**Demo:** After this: After S03: @kodiai mention in a GitHub PR → ACA Job appears in Azure portal executions list → job completes → GitHub comment posted with agent response. Job container env inspection (via Azure portal or job logs): only ANTHROPIC_API_KEY, MCP_BEARER_TOKEN, WORKSPACE_DIR, GITHUB_INSTALLATION_TOKEN present.

## Tasks
- [x] **T01: Add cancelAcaJob(), acaResourceGroup/acaJobName config fields, Dockerfile.agent, and fix deploy.sh agent build target** — Three small additions that unblock T02 and T03:
1. Add cancelAcaJob() to src/jobs/aca-launcher.ts — thin wrapper around `az containerapp job execution stop`. Signature: `{ resourceGroup, jobName, executionName, logger? }`. Logs at info level after cancellation.
2. Add acaResourceGroup and acaJobName to configSchema in src/config.ts (Zod string with defaults 'rg-kodiai' and 'caj-kodiai-agent'). Add to loadConfig() input object reading from process.env.ACA_RESOURCE_GROUP and process.env.ACA_JOB_NAME. Update AppConfig stubs in test files that need the new fields (check src/routes/slack-events.test.ts and src/routes/slack-commands.test.ts).
3. Create Dockerfile.agent — same base as Dockerfile (oven/bun:1-debian), same git/python3/kodi-addon-checker layer, same src/ copy pattern, but CMD is 'bun run src/execution/agent-entrypoint.ts' instead of 'src/index.ts'. No EXPOSE — the agent job has no incoming ports.
4. Update deploy.sh: the agent image build section already targets kodiai-agent:latest but uses the main Dockerfile (or no --file flag). Change it to `az acr build ... --image kodiai-agent:latest --file Dockerfile.agent .` so the agent image gets the correct entrypoint.
  - Estimate: 45m
  - Files: src/jobs/aca-launcher.ts, src/jobs/aca-launcher.test.ts, src/config.ts, src/routes/slack-events.test.ts, src/routes/slack-commands.test.ts, Dockerfile.agent, deploy.sh
  - Verify: bun test ./src/jobs/aca-launcher.test.ts && bun run tsc --noEmit && bash -n Dockerfile.agent
- [x] **T02: Created agent-entrypoint.ts (ACA job container script) and 13 passing unit tests covering all env-var, config, SDK, and error paths** — Create src/execution/agent-entrypoint.ts — the script the ACA Job container runs.

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
  - Estimate: 1h
  - Files: src/execution/agent-entrypoint.ts, src/execution/agent-entrypoint.test.ts
  - Verify: bun test ./src/execution/agent-entrypoint.test.ts && bun run tsc --noEmit
- [ ] **T03: Executor refactor and registry DI** — Replace the query() SDK loop in createExecutor() with the ACA job dispatch path, and thread mcpJobRegistry as a dependency.

**1. config.ts additions (if not done in T01):** acaResourceGroup and acaJobName should already be present from T01.

**2. createExecutor() signature:** Add mcpJobRegistry: McpJobRegistry to the deps type.

**3. New dispatch flow in execute():**

a. Keep all existing setup up to and including buildMcpServers() — model resolution, timeout config, MCP server config, allowed tools, prompt building, workspace CLAUDE.md write.

b. Instead of calling query() directly, do:
   - Generate per-job bearer token: `const mcpBearerToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');`
   - Build factory map: for each (name, server) in Object.entries(mcpServers), wrap in a factory `() => server as McpSdkServerConfigWithInstance`. Register all factories in the registry under mcpBearerToken with TTL = (timeoutSeconds + 60) * 1000.
   - Create workspace dir on Azure Files: `const workspaceDir = await createAzureFilesWorkspaceDir({ mountBase: '/mnt/kodiai-workspaces', jobId: context.deliveryId ?? crypto.randomUUID() });`
   - Write agent-config.json and prompt.txt to workspaceDir:
     ```ts
     await writeFile(join(workspaceDir, 'prompt.txt'), prompt);
     await writeFile(join(workspaceDir, 'agent-config.json'), JSON.stringify({ model, maxTurns, allowedTools, taskType }));
     ```
   - Build job spec: `buildAcaJobSpec({ jobName: config.acaJobName, image: config.acaJobImage, workspaceDir, anthropicApiKey: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY, mcpBearerToken, mcpBaseUrl: config.mcpInternalBaseUrl, githubInstallationToken: await githubApp.getInstallationToken(context.installationId), timeoutSeconds })`
   - Launch: `const { executionName } = await launchAcaJob({ resourceGroup: config.acaResourceGroup, jobName: config.acaJobName, spec, logger });`
   - Poll with timeout: `const { status, durationMs } = await pollUntilComplete({ resourceGroup: config.acaResourceGroup, jobName: config.acaJobName, executionName, timeoutMs, logger });`
   - If status === 'timed-out': call cancelAcaJob(), clear registry, return timeout ExecutionResult.
   - If status === 'failed': clear registry, return failure ExecutionResult.
   - Read result: `const rawResult = await readJobResult(workspaceDir); const jobResult = rawResult as ExecutionResult;`
   - Clear registry: `registry.unregister(mcpBearerToken);`
   - Return jobResult with durationMs filled from the poll.

**4. published flag:** The onPublish/onPublishEvent callbacks are closures registered in buildMcpServers() and called by the orchestrator's MCP HTTP server when the agent job invokes a tool. This works because those callbacks close over mutable `published` and `publishEvents` variables in the executor. Keep those variables and callbacks — they still fire during pollUntilComplete(). After readJobResult(), merge `published` and `publishEvents` into the returned result.

**5. AbortController:** Remove the AbortController/setTimeout timeout mechanism — timeout is now managed by pollUntilComplete() + cancelAcaJob(). Remove buildAgentEnv() import if it's no longer used.

**6. index.ts:** Pass `mcpJobRegistry` to `createExecutor()`. Check that mcpJobRegistry is declared before createExecutor() call (already the case per current index.ts order — executor is line 181, mcpJobRegistry is line 184; swap the order).

**Tests in executor.test.ts:** Mock launchAcaJob, pollUntilComplete, readJobResult, createAzureFilesWorkspaceDir. Test:
- Happy path: poll returns succeeded, readJobResult returns valid result → ExecutionResult returned
- Timeout path: poll returns timed-out → cancelAcaJob called, timeout ExecutionResult returned
- Failed path: poll returns failed → failure ExecutionResult returned
- Registry: token registered before launch, unregistered after completion
- published flag propagation: onPublish callback fires (simulated by calling it directly), result has published: true
  - Estimate: 2h
  - Files: src/execution/executor.ts, src/execution/executor.test.ts, src/index.ts
  - Verify: bun test ./src/execution/executor.test.ts && bun run tsc --noEmit
