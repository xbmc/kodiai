---
estimated_steps: 31
estimated_files: 3
skills_used: []
---

# T03: Executor refactor and registry DI

Replace the query() SDK loop in createExecutor() with the ACA job dispatch path, and thread mcpJobRegistry as a dependency.

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

## Inputs

- ``src/execution/executor.ts` — the file being refactored`
- ``src/jobs/aca-launcher.ts` — cancelAcaJob (T01), launchAcaJob, pollUntilComplete, readJobResult`
- ``src/jobs/workspace.ts` — createAzureFilesWorkspaceDir`
- ``src/execution/mcp/http-server.ts` — McpJobRegistry type`
- ``src/config.ts` — acaResourceGroup, acaJobName, mcpInternalBaseUrl, acaJobImage (T01)`
- ``src/index.ts` — wire mcpJobRegistry dep`

## Expected Output

- ``src/execution/executor.ts` — createExecutor() uses ACA job dispatch instead of query() loop`
- ``src/execution/executor.test.ts` — tests for new dispatch path (happy, timeout, failed, registry lifecycle)`
- ``src/index.ts` — mcpJobRegistry passed to createExecutor(); mcpJobRegistry declared before executor`

## Verification

bun test ./src/execution/executor.test.ts && bun run tsc --noEmit
