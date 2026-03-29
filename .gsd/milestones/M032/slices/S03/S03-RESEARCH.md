# S03 Research: Agent Job Entrypoint + Executor Refactor

**Authored:** 2026-03-29
**Complexity:** Targeted — known architecture with established S01/S02 primitives, moderate integration complexity

---

## Summary

S03 wires the two foundation slices (S01: ACA launcher + workspace, S02: MCP HTTP registry) into the orchestrator's execution path. The concrete deliverables are:

1. **`src/execution/agent-entrypoint.ts`** — the script the ACA Job container runs. Reads env vars, clones workspace, writes CLAUDE.md, calls `query()` with `McpHttpServerConfig` entries pointing at the orchestrator, writes `result.json`.
2. **Refactored `createExecutor()`** — replaces the `for await` SDK loop with: register MCP factories in registry → generate bearer token → `buildAcaJobSpec()` + `launchAcaJob()` → `pollUntilComplete()` → `readJobResult()` → `unregister()`. Returns same `ExecutionResult` type.
3. **Registry DI** — the `mcpJobRegistry` in `index.ts` must be threaded to `createExecutor()` so dispatch can register/unregister per job.
4. **Config additions** — `acaResourceGroup` and `acaJobName` fields needed in `AppConfig` / `loadConfig()`.
5. **`cancelAcaJob()`** — new export in `aca-launcher.ts` for timeout-triggered cancellation.
6. **Agent Dockerfile** — the `Dockerfile` currently builds the orchestrator. The `deploy.sh` agent image build (`az acr build ... --image kodiai-agent:latest`) uses the same Dockerfile + same `src/index.ts` entrypoint. The agent job needs a different entrypoint. Decision required (see Architecture below).

---

## Recommendation

- **Two-entrypoint approach using a `CMD` override**: keep one Dockerfile, make the agent job container invoke `bun run src/execution/agent-entrypoint.ts` (set via `--command` in `az containerapp job create` or via Dockerfile `CMD` argument at image build time). Since `deploy.sh` uses `az acr build` to produce `kodiai-agent:latest` from the same Dockerfile, a second `Dockerfile.agent` is the cleanest separation.
- **Registry DI via dependency injection on `createExecutor()`**: add `mcpJobRegistry: McpJobRegistry` as a dependency alongside `githubApp`, `logger`, etc. Index.ts already holds `mcpJobRegistry`; pass it in at construction.
- **`cancelAcaJob()` in `aca-launcher.ts`**: thin wrapper around `az containerapp job execution stop --name ... --job-execution-name ...`. Called from executor's timeout path instead of `controller.abort()`.

---

## Implementation Landscape

### Files That Change

| File | What changes |
|------|-------------|
| `src/execution/executor.ts` | Replace `query()` loop with ACA dispatch + poll + result read. Add `mcpJobRegistry` dep. Per-job token generation. Timeout → `cancelAcaJob()`. |
| `src/execution/agent-entrypoint.ts` | New file. The script the ACA Job container runs. |
| `src/jobs/aca-launcher.ts` | Add `cancelAcaJob()` export. |
| `src/config.ts` | Add `acaResourceGroup` and `acaJobName` to `configSchema`. |
| `src/index.ts` | Pass `mcpJobRegistry` to `createExecutor()`. |
| `Dockerfile.agent` | New file. Bun image, copies src/, `CMD bun run src/execution/agent-entrypoint.ts`. |
| `deploy.sh` | Update agent image build to use `Dockerfile.agent`; pass `MCP_INTERNAL_BASE_URL` and `ACA_JOB_NAME` into orchestrator env. |

### Files That Do NOT Change

- `src/execution/types.ts` — `ExecutionContext` and `ExecutionResult` unchanged; callers (review.ts, mention.ts, index.ts) are shielded.
- `src/execution/mcp/index.ts` — `buildMcpServers()` still exists; executor calls it to build factories for the registry.
- `src/execution/mcp/http-server.ts` — unchanged; executor calls `registry.register()` / `registry.unregister()`.
- `src/jobs/workspace.ts` — unchanged; `createAzureFilesWorkspaceDir()` already exported from S01.
- `src/execution/env.ts` — `buildAgentEnv()` is no longer called by executor (the job has its own env); `AGENT_ENV_ALLOWLIST` can stay as-is or be deprecated — don't delete yet, could be referenced elsewhere.

---

## Key Integration Points

### 1. Executor refactor — the dispatch flow

Current executor (`src/execution/executor.ts`) calls:
```ts
const sdkQuery = query({ prompt, options: { mcpServers, env: buildAgentEnv(), ... } });
for await (const message of sdkQuery) { ... }
```

New executor calls `buildMcpServers()` to get in-process server instances, then:
```ts
// 1. Generate per-job token
const mcpBearerToken = crypto.randomUUID().replace(/-/g, "");  // 32 hex chars

// 2. Register factories in MCP HTTP registry (with TTL = timeoutSeconds + 60s buffer)
const factories: Record<string, () => McpSdkServerConfigWithInstance> = {};
for (const [name, server] of Object.entries(mcpServers)) {
  factories[name] = () => server as McpSdkServerConfigWithInstance;
}
registry.register(mcpBearerToken, factories, (timeoutSeconds + 60) * 1000);

// 3. Create workspace dir on Azure Files
const workspaceDir = await createAzureFilesWorkspaceDir({
  mountBase: "/mnt/kodiai-workspaces",
  jobId: deliveryId ?? crypto.randomUUID(),
});

// 4. Build job spec + launch
const spec = buildAcaJobSpec({
  jobName: config.acaJobName,
  image: config.acaJobImage,
  workspaceDir,
  anthropicApiKey: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY,
  mcpBearerToken,
  mcpBaseUrl: config.mcpInternalBaseUrl,
  githubInstallationToken: context.workspace.token,
  timeoutSeconds,
});
const { executionName } = await launchAcaJob({ resourceGroup: config.acaResourceGroup, jobName: config.acaJobName, spec, logger });

// 5. Poll + cancel on timeout
const { status, durationMs } = await pollUntilComplete({ ..., timeoutMs });
if (status === "timed-out") {
  await cancelAcaJob({ resourceGroup, jobName, executionName, logger });
}

// 6. Read result.json
const rawResult = await readJobResult(workspaceDir);
const result = rawResult as ExecutionResult;  // agent writes this shape

// 7. Clean up registry entry
registry.unregister(mcpBearerToken);
```

**`published` tracking**: the executor currently sets `published = true` in the `onPublish` callback. With ACA Jobs, `onPublish` is wired in `buildMcpServers()` but the server lives in the HTTP registry. The MCP comment server calls `onPublish()` when it posts to GitHub. This callback fires in the orchestrator process (the HTTP server handles the agent job's MCP tool call) — so `published` can still be tracked in the executor via closure. The `onPublish` callback passed to `buildMcpServers()` should set a mutable flag that the executor reads after `pollUntilComplete()`.

The `publishEvents` array works the same way: `onPublishEvent` is in the orchestrator, fires when the agent job calls MCP tools.

### 2. Agent entrypoint (`src/execution/agent-entrypoint.ts`)

The agent job reads from its own environment:
```
WORKSPACE_DIR        — path on the Azure Files mount
MCP_BASE_URL         — orchestrator's internal URL
MCP_BEARER_TOKEN     — per-job bearer token
ANTHROPIC_API_KEY    — Anthropic key (passed as CLAUDE_CODE_OAUTH_TOKEN OR ANTHROPIC_API_KEY)
GITHUB_INSTALLATION_TOKEN — optional, for write-mode push
```

Responsibilities:
1. Read env vars (exit 1 with clear message if missing required vars)
2. Write `CLAUDE.md` (call `buildSecurityClaudeMd()` — reuse from executor.ts)
3. Build `mcpServers` as `McpHttpServerConfig` entries:
   ```ts
   const mcpServers: Record<string, McpHttpServerConfig> = {
     github_comment:            { type: "http", url: `${mcpBaseUrl}/internal/mcp/github_comment`,            headers: { Authorization: `Bearer ${mcpBearerToken}` } },
     reviewCommentThread:       { type: "http", url: `${mcpBaseUrl}/internal/mcp/reviewCommentThread`,       headers: { ... } },
     github_inline_comment:     { type: "http", url: `${mcpBaseUrl}/internal/mcp/github_inline_comment`,     headers: { ... } },
     github_ci:                 { type: "http", url: `${mcpBaseUrl}/internal/mcp/github_ci`,                 headers: { ... } },
     review_checkpoint:         { type: "http", url: `${mcpBaseUrl}/internal/mcp/review_checkpoint`,         headers: { ... } },
     github_issue_label:        { type: "http", url: `${mcpBaseUrl}/internal/mcp/github_issue_label`,        headers: { ... } },
     github_issue_comment:      { type: "http", url: `${mcpBaseUrl}/internal/mcp/github_issue_comment`,      headers: { ... } },
   };
   ```
   **Only include servers actually registered for this job** — the agent can't know which servers are registered. Simplest solution: always include all 7 server names in the HTTP config. The registry will 404 for servers not registered for that token; the agent will see a failed tool call and move on. Or: the executor writes a `job-manifest.json` with the registered server names before launching. The latter is cleaner but adds complexity. **Simplest: always register all server factories that `buildMcpServers()` produced, and always include all corresponding HTTP entries in the agent. 404s are handled gracefully.**

4. Call `query()` with appropriate options (model from `AGENT_MODEL` env var or default, `allowedTools` from `AGENT_ALLOWED_TOOLS` env var — a comma-separated list passed by the executor), cwd = `workspaceDir`.
5. Collect result messages, write `result.json` to `workspaceDir`.

**The prompt**: the executor must write the prompt to `workspaceDir/prompt.txt` before launching the job. The agent reads `WORKSPACE_DIR/prompt.txt` as input. This avoids the env var size limit.

**`allowedTools` and `model`**: these are per-execution configuration that lives in the orchestrator. The executor should write them to `workspaceDir/agent-config.json` along with the prompt, not as env vars (env var character limits).

### 3. Config additions needed

`src/config.ts` is missing `acaResourceGroup` and `acaJobName`. Add:
```ts
acaResourceGroup: z.string().default("rg-kodiai"),
acaJobName: z.string().default("caj-kodiai-agent"),
```
And in `loadConfig()`:
```ts
acaResourceGroup: process.env.ACA_RESOURCE_GROUP,
acaJobName: process.env.ACA_JOB_NAME,
```

These have safe defaults matching deploy.sh constants, so they don't need to be required.

### 4. `cancelAcaJob()` in aca-launcher.ts

```ts
export async function cancelAcaJob(opts: {
  resourceGroup: string;
  jobName: string;
  executionName: string;
  logger?: Logger;
}): Promise<void> {
  await $`az containerapp job execution stop \
    --name ${opts.jobName} \
    --resource-group ${opts.resourceGroup} \
    --job-execution-name ${opts.executionName}`.quiet().nothrow();
  opts.logger?.info({ executionName: opts.executionName }, "ACA Job cancelled");
}
```

### 5. Registry DI threading

`createExecutor()` currently takes `{ githubApp, logger, costTracker?, taskRouter? }`. Add `mcpJobRegistry: McpJobRegistry` to the deps type. `index.ts` already creates `mcpJobRegistry` before `createExecutor()` — just pass it in. The Slack paths (`slackWriteRunner`, `slackAssistantHandler`) call `executor.execute()` via lambdas, so no changes needed there.

### 6. Dockerfile.agent

Simple. Copies the same `src/` tree, installs same `node_modules`, but uses:
```dockerfile
CMD ["bun", "run", "src/execution/agent-entrypoint.ts"]
```
No git needed in the agent image (git is on the orchestrator side via `createWorkspaceManager()`; the agent job reads a pre-populated workspace dir).

Actually — the agent **does** need git if it runs write-mode (Edit → commit → push). Write-mode needs `git commit` and `git push`. The workspace is a git clone done by the orchestrator. The agent job needs git to stage/commit/push changes. Keep git in the agent image.

`deploy.sh` must be updated to build `kodiai-agent:latest` from `Dockerfile.agent`:
```bash
az acr build --registry "$ACR_NAME" --image kodiai-agent:latest --file Dockerfile.agent .
```

---

## Ordering / Seams for Task Decomposition

**T01 — `cancelAcaJob()` + config additions + Dockerfile.agent**
- Small, self-contained, unblocks T02 and T03
- `cancelAcaJob()` in `aca-launcher.ts` (3 lines + test)
- `acaResourceGroup` and `acaJobName` in `config.ts`
- `Dockerfile.agent` new file
- Verify: `bun run tsc --noEmit`, bash -n Dockerfile.agent (syntax), new config field test
- Files: `src/jobs/aca-launcher.ts`, `src/config.ts`, `Dockerfile.agent`

**T02 — `src/execution/agent-entrypoint.ts`**
- The script the ACA Job container runs
- Reads env vars, reads `agent-config.json` from workspace, writes `CLAUDE.md`, calls `query()` with HTTP MCP configs, writes `result.json`
- Reuses `buildSecurityClaudeMd()` from executor.ts
- Verify: unit test for happy path (mock `query()`), test for missing-env error exit
- Files: `src/execution/agent-entrypoint.ts`, `src/execution/agent-entrypoint.test.ts`

**T03 — Executor refactor**
- Replace `query()` loop in `executor.ts` with ACA dispatch path
- Add `mcpJobRegistry: McpJobRegistry` dep
- Write `agent-config.json` + `prompt.txt` to workspace before launch
- Token generation, registry register/unregister, launch → poll → result read
- Thread registry dep in `index.ts`
- Verify: unit tests for the new dispatch flow (mock `launchAcaJob`, `pollUntilComplete`, `readJobResult`), `bun run tsc --noEmit`
- Files: `src/execution/executor.ts`, `src/index.ts`, `src/execution/executor.test.ts`

---

## Risks and Constraints

### Risk 1: `published` flag threading (MEDIUM)
The executor currently uses a `published` flag set by `onPublish()` closure from `buildMcpServers()`. The MCP HTTP server in the orchestrator calls this closure when the agent job's tool call arrives. This works — the callback is in the orchestrator process — but the executor must keep a mutable `published` and `publishEvents` array in the outer closure that the `onPublish`/`onPublishEvent` callbacks write to. Verified this is structurally sound: the callbacks are registered before the job is launched and fire during `pollUntilComplete()` (which is `await`ing while the job runs).

### Risk 2: Prompt and config passing via filesystem (LOW)
Writing `prompt.txt` and `agent-config.json` to the Azure Files mount before launch adds SMB I/O to the critical path. For a typical prompt (a few KB), this is negligible. The alternative (env vars) has a 4KB ACA env var limit per variable and prompts can be larger.

### Risk 3: Agent container MCP server name enumeration (LOW)
The agent always builds HTTP MCP configs for all 7 server names. If the executor only registered 3 (e.g., no inline tools for a mention), the agent will encounter 404s for the other 4. The SDK should handle a 404 from an MCP server gracefully (tool call error, not a crash). Verify this in T02 tests.

### Risk 4: `buildAgentEnv()` still called by Slack paths (MEDIUM)
`slackWriteRunner` and `slackAssistantHandler` call `executor.execute()` via lambdas in `index.ts`. After the executor refactor, these Slack paths will dispatch ACA Jobs too — which is intended. But check: the Slack paths pass `writeMode: true` and expect `resultText` back. The `result.json` written by the agent must include `resultText`. This is already in `ExecutionResult` — the agent writes the full result shape. The Slack read-back path in `slackAssistantHandler` already extracts `result.answerText`. This should work.

### Risk 5: `executor.execute()` called 4 times in `index.ts` (LOW)
Two in `index.ts` directly (Slack), two in handler factories (review.ts L2518+L3693, mention.ts L1762). All go through `executor.execute()` — the refactor is in one place. No handler changes needed.

### Risk 6: Token for ANTHROPIC_API_KEY vs CLAUDE_CODE_OAUTH_TOKEN (LOW)
`deploy.sh` stores `CLAUDE_CODE_OAUTH_TOKEN` in the orchestrator's secrets. The ACA Job's env uses `ANTHROPIC_API_KEY` key name (as built by `buildAcaJobSpec()`). The executor must pass the orchestrator's `CLAUDE_CODE_OAUTH_TOKEN` value as `anthropicApiKey` to `buildAcaJobSpec()`. `CLAUDE_CODE_OAUTH_TOKEN` is in `AGENT_ENV_ALLOWLIST` but not in `AppConfig`. Either add it to config or read `process.env.CLAUDE_CODE_OAUTH_TOKEN` directly in executor. Since it's a secret, **read from `process.env` directly** — same pattern as other secrets not in AppConfig.

---

## Verification Plan

After all three tasks:
```bash
bun run tsc --noEmit                             # zero errors
bun test ./src/execution/executor.test.ts        # new dispatch tests pass
bun test ./src/execution/agent-entrypoint.test.ts # entrypoint tests pass
bun test ./src/jobs/aca-launcher.test.ts         # cancelAcaJob test passes
bash -n Dockerfile.agent                         # syntax clean
bun run scripts/test-aca-job.ts                  # contract check still passes
```

Slice S03 success = GitHub @kodiai mention triggers ACA Job dispatch (verified by manual smoke test against Azure) + job env inspection shows only the 4 permitted env vars.
