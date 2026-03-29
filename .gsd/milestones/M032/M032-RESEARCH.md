# M032 Research: Agent Process Isolation — Ephemeral ACA Job Sandbox

**Authored:** 2026-03-29  
**Status:** Complete — ready for roadmap planning

---

## 1. Problem Confirmation

### The `/proc` leak is real and the current `buildAgentEnv()` defence is insufficient

`src/execution/env.ts` implements `buildAgentEnv()` — an allowlist that filters which keys are passed to the SDK subprocess. The allowlist correctly excludes `DATABASE_URL`, `GITHUB_PRIVATE_KEY`, `SLACK_BOT_TOKEN`, etc. **But** the subprocess runs inside the same Linux container as the Bun HTTP server. The Bun server is PID 1. On Linux, `/proc/1/environ` is readable by any process with the same UID — the non-root `bun` user in the Docker image (`USER bun`). A prompt-injected Bash tool call like `cat /proc/1/environ | tr '\0' '\n'` exposes every secret visible in the orchestrator process, bypassing the allowlist completely.

The SDK spawns the subprocess using `child_process.spawn` (confirmed in `cli.js` — `SS7.default(...)`). The spawned process is a child of the Bun server with inherited UID, which is exactly the vulnerable relationship.

---

## 2. Codebase Survey

### `src/execution/executor.ts` — primary change surface

The `createExecutor()` function is the single entry point for all agent executions. It:
- Loads repo config
- Builds `mcpServers` (in-process SDK servers)
- Calls `query()` with `env: { ...buildAgentEnv(), CLAUDE_CODE_ENTRYPOINT: "..." }`
- Streams result messages via `for await`
- Returns `ExecutionResult`

**After M032**, this function needs to dispatch an ACA Job instead of calling `query()`. The `for await` loop becomes a poll loop on the ACA Job execution status API. The `ExecutionResult` comes from reading `result.json` written to shared storage.

**Callers of `executor.execute()`:** `src/handlers/review.ts` (lines 2518, 3693) and `src/handlers/mention.ts` (line 1762). The `ExecutionContext` type (in `src/execution/types.ts`) and `ExecutionResult` type remain unchanged — callers are shielded from the architectural change.

### `src/execution/mcp/index.ts` — the 7 MCP servers

`buildMcpServers()` returns `Record<string, McpServerConfig>` where every entry is a `McpSdkServerConfigWithInstance` (type `'sdk'` with a live `McpServer` instance). These are in-process — they can't be serialized or sent to a remote process.

The switch: instead of passing `McpSdkServerConfigWithInstance` entries to the in-process SDK's `query()`, these servers must be **exposed over HTTP** from the orchestrator. The agent job then uses `McpHttpServerConfig` entries (`{ type: 'http', url: string, headers?: Record<string, string> }`).

**Key SDK type confirmed:**
```ts
type McpHttpServerConfig = {
    type: 'http';
    url: string;
    headers?: Record<string, string>;
};
```
This is natively supported by the Claude Agent SDK — no SDK changes needed. The agent job can call MCP HTTP endpoints directly.

### MCP HTTP transport in `@modelcontextprotocol/sdk`

The MCP SDK (v1.26.0) includes `WebStandardStreamableHTTPServerTransport` — confirmed in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.d.ts`. It explicitly supports Bun: *"It can run on any runtime that supports Web Standards: Node.js 18+, Cloudflare Workers, Deno, Bun, etc."*

The orchestrator can expose MCP servers via Hono routes using `WebStandardStreamableHTTPServerTransport` with stateless mode (`sessionIdGenerator: undefined`). No Express dependency needed — Hono already in the codebase.

### `src/jobs/workspace.ts` — workspace location change

`createWorkspaceManager()` calls `mkdtemp(join(tmpdir(), "kodiai-"))` — creating workspace in `/tmp` (local to the container). This must change to an **Azure Files mount path** (`/mnt/kodiai-workspaces/<jobId>/`).

The `cleanup()` function uses `rm` — unchanged semantics, just a different base path.
`cleanupStale()` scans for `kodiai-*` prefix in `tmpdir()` — needs updating to scan `/mnt/kodiai-workspaces/` or the old tmpdir scan becomes a no-op (acceptable, stale ACA job dirs are cleaned by workspace lifecycle logic anyway).

The `token` field on `Workspace` is used for push/fetch operations (passed to `makeAuthUrl()`). In the new model this token lives only in memory in the orchestrator; it's written into the ACA Job's env as `GITHUB_INSTALLATION_TOKEN` for the job to use. This is acceptable — a scoped per-repo installation token with short TTL, not a durable application secret.

### `src/jobs/types.ts` — no structural changes needed

`WorkspaceManager.create()` signature stays the same. `Workspace` interface (`dir`, `cleanup()`, `token?`) stays the same. Only the implementation of `create()` changes (path from tmpdir → Azure Files).

### `deploy.sh` — needs additions, not rewrites

The deploy script uses `az containerapp update` pattern — idempotent, safe to extend. Needs additions:
- Azure Storage account + Files share creation
- ACA Jobs environment definition (`az containerapp job create`)
- Azure Files volume mount on both orchestrator and job container
- New env vars for job config (subscription ID, resource group, job name, internal MCP endpoint URL)

### Existing `verify:m031` pattern

The verification pattern (`scripts/verify-m031.ts`) is the model for `verify:m032`. It tests: job spec has zero application secrets, MCP HTTP auth middleware rejects 401 on missing/wrong token, workspace path is on Azure Files mount. These are deterministic pure-code checks — no live Azure infrastructure needed.

---

## 3. ACA Jobs API — JS/TS Client

**`@azure/arm-appcontainers` + `@azure/identity`** — both are npm packages. Confirmed to support Node.js/TypeScript. Not currently in `package.json`.

Key operations:
```ts
import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { DefaultAzureCredential } from "@azure/identity";

const client = new ContainerAppsAPIClient(new DefaultAzureCredential(), subscriptionId);

// Start a job execution (with env override per-job)
const execution = await client.jobs.start(resourceGroup, jobName, {
  containers: [{ image: "...", name: "main", env: [...] }]
});

// Poll execution status
const status = await client.jobExecution.get(resourceGroup, jobName, executionName);
// status.properties.status: "Running" | "Succeeded" | "Failed"
```

**Authentication concern for the orchestrator:** The orchestrator runs as ACA container app `ca-kodiai` with managed identity `id-kodiai`. The managed identity needs `Contributor` role on the ACA Job resource (or a custom role scoped to just Jobs operations). `DefaultAzureCredential` picks up the managed identity automatically when running in ACA.

**SDK vs raw REST API vs `az` CLI:** The Azure SDK for JS is the cleanest option. The raw REST API is callable via `fetch` (no extra deps) with a managed identity token from the IMDS endpoint. The `az` CLI subprocess is the simplest to prototype but adds latency and a shell dep. 

**Recommended approach:** Start with raw REST API calls via `fetch` to avoid adding `@azure/arm-appcontainers` + `@azure/identity` (each pulls significant dependencies). The IMDS token endpoint is `http://169.254.169.254/metadata/identity/oauth2/token`. Two calls: get token, POST to start job. Poll via GET. This is testable, minimal, and avoids Bun compatibility questions with the Azure SDK.

**Fallback:** If raw REST proves awkward, add `@azure/identity` for `DefaultAzureCredential` and call the REST API manually. Or add both packages — they're pure JS and should work with Bun.

---

## 4. Architecture Decision Points

### 4.1 Result passing mechanism

**Option A: Azure Files share (proposed in context)**  
Agent job writes `result.json` to `/mnt/kodiai-workspaces/<jobId>/result.json`. Orchestrator polls both ACA Job status API and for the file's existence. Clean separation, but adds Azure Files I/O and SMB mount overhead.

**Option B: Job exit code + result via environment variable**  
Agent job base64-encodes the `ExecutionResult` JSON into an env var read by the orchestrator. Works only if result is small (< ~32KB ACA env var limit). Unsuitable for review results that may include large resultText.

**Option C: Direct HTTP callback from job to orchestrator**  
Agent job POSTs the result to an internal HTTP endpoint on the orchestrator. Requires the orchestrator's internal URL to be injected into the job env. Clean and fast, no file I/O. The orchestrator needs a `/internal/job-result` endpoint guarded by a per-job token.

**Recommendation:** Option C (HTTP callback) is simpler than Azure Files for result passing and avoids adding SMB mount to the critical path. Azure Files is still needed for the workspace (git clone), but `result.json` delivery is a different concern.

Actually, re-reading the context: the workspace IS needed for the git clone (the agent must read repo files). So Azure Files is unavoidable for workspace sharing. Given that the share is already mounted, writing `result.json` there is trivially cheap. **Stick with Option A (Azure Files + result.json polling)** — no extra endpoint needed, simpler failure model.

### 4.2 ACA Job definition strategy

Two options:
- **Pre-defined job definition** (create job resource once in deploy.sh; start executions per invocation): Lower per-execution latency, simpler auth (job already configured with managed identity). **Recommended.**
- **Create new job per invocation**: Maximum isolation but much slower — job provisioning adds 10-30s beyond execution cold start.

The pre-defined job template specifies the image and default config. Per-execution env vars (job ID, MCP endpoint URL, MCP token, workspace path, GitHub token, Anthropic token) are injected at start time via the execution template override.

### 4.3 MCP HTTP transport — stateful vs stateless

The `WebStandardStreamableHTTPServerTransport` supports both modes. For this use case:
- **Stateless** (no session tracking): Per-request — the agent calls an MCP tool, gets a response, done. No persistent connection needed. Simpler.
- **Stateful** (session ID): Required if the agent needs to stream results or resume interrupted sessions. The SDK's `McpHttpServerConfig` doesn't expose session management — it's handled transparently.

**Recommendation:** Stateless mode per request. Each tool call creates a fresh HTTP exchange. This maps cleanly to the existing in-process MCP server behavior (no state between tool calls in most servers).

### 4.4 Per-job MCP bearer token

Simple: `crypto.randomBytes(32).toString('hex')` at job dispatch time. Stored in `Map<executionId, token>` in the orchestrator, cleaned up when the job completes. The token is passed to the job as `MCP_BEARER_TOKEN` env var. The HTTP MCP endpoint validates this against the map.

The per-job token scope: valid only for the duration of one job execution. If the job takes longer than the map entry TTL (set to `timeoutSeconds + buffer`), requests are rejected. Clean audit trail.

### 4.5 Internal networking — MCP endpoint reachability

The MCP HTTP endpoint must be reachable from inside the ACA environment but **not** from the internet. ACA supports internal-only ingress. The orchestrator (app) can be configured with dual ingress: external for GitHub webhooks, internal for MCP calls from job containers.

In the same ACA environment, job containers reach other container apps via internal FQDN: `https://ca-kodiai.internal.<env-name>.eastus.azurecontainerapps.io`. This internal FQDN must be injected as `MCP_BASE_URL` into the job env.

---

## 5. Key Risks and Risk Ordering

### Risk 1: ACA Job cold start latency (HIGH — prove first)
S01 should include a latency probe: spawn a trivial ACA Job and measure time from API call to first log line. Typical range is 5-20s. If >15s consistently, the architecture may require reconsideration for interactive `@kodiai` mentions. Mitigation: pre-warmed job infrastructure (ACA Jobs don't support warm instances in current API). Fallback path: Slack mention continues using in-process for latency-sensitive cases; only PR review (which is async anyway) moves to ACA Jobs in M032.

### Risk 2: Azure Files SMB performance for git operations (MEDIUM)
Git clone + checkout on SMB can be 2-5x slower than local tmpfs, especially for repos with many files. The workspace manager already does shallow clones (`depth=1`). Measure in S01/S02 before optimizing. If unacceptable: clone locally in the job container and transfer only `result.json` back via local filesystem + HTTP callback (eliminates Azure Files from the git I/O path entirely).

### Risk 3: `@azure/identity`/`@azure/arm-appcontainers` Bun compatibility (LOW-MEDIUM)
The Azure SDK for JS is designed for Node.js. Bun has high Node.js compatibility but the Azure SDK may use Node-specific APIs. Mitigated by using raw REST API calls via `fetch` for the initial implementation — this has zero dependency risk. If the Azure SDK approach is needed later, test it in isolation before committing.

### Risk 4: MCP HTTP transport statefulness (MEDIUM)
The current in-process MCP servers carry per-invocation state (e.g., `onPublish` callback, `reviewOutputKey`, `published` flag). These cannot be serialized. In the new model, these callbacks remain in the **orchestrator** — the MCP HTTP server in the orchestrator holds the context, and the agent job just calls the HTTP endpoint. This is architecturally clean but requires careful wiring: the orchestrator's MCP HTTP server is created **per-job** (each job has its own MCP server instance with its own callbacks), not globally.

### Risk 5: Timeout/cancellation wiring (LOW-MEDIUM)
The current `AbortController` pattern (`setTimeout → controller.abort()`) terminates the in-process `query()` call. With ACA Jobs, the orchestrator must call `jobs.stop(executionId)` when the timeout fires. The job itself doesn't see the abort signal — it just gets killed. The orchestrator must handle job timeout as a different error path.

### Risk 6: Workspace token threading (LOW)
`Workspace.token` is currently used by push/fetch operations inside handlers that call into workspace functions after `executor.execute()` completes. In write-mode, the token is needed to push commits. In the ACA Job model, the job carries the token itself (as `GITHUB_INSTALLATION_TOKEN` env var). The installation token is a short-lived per-repo token, not a durable application secret — acceptable to put in job env.

---

## 6. Proposed Slice Order

### S01: ACA Job infrastructure + latency measurement (Risk: HIGH)
**Goal:** Prove the ACA Job cold start is acceptable and the infrastructure plumbing works.
- Build the agent job container image (minimal: Bun + claude-agent-sdk + a no-op agent script)
- Add job creation + execution start to `deploy.sh`
- Implement `src/jobs/aca-job-launcher.ts` — starts a job and polls for completion using raw REST API
- Measure cold start latency in integration test (requires real Azure creds — integration-only)
- Proof harness (pure-code): job spec JSON contains no application secret names
**Prove before building:** if cold start is >20s, reconsider the architecture for mention handling

### S02: Azure Files workspace + workspace manager update (Risk: MEDIUM)
**Goal:** Agent job container reads/writes workspace on Azure Files share.
- Add Azure Files share creation to `deploy.sh`
- Update `createWorkspaceManager()` to use `/mnt/kodiai-workspaces/` base path
- Verify git operations work on the mounted share (integration test with real SMB)
- Implement `result.json` write (agent side) + read (orchestrator side)

### S03: MCP HTTP server in orchestrator (Risk: MEDIUM)
**Goal:** All 7 MCP servers exposed over Hono routes with per-job bearer auth.
- Add `src/execution/mcp/http-server.ts` — creates per-job MCP HTTP servers using `WebStandardStreamableHTTPServerTransport`
- Add Hono routes under `/internal/mcp/*` with bearer token middleware
- Proof: middleware rejects requests with missing/wrong token (401)
- Proof: middleware accepts requests with correct token
- Per-job token map with TTL cleanup

### S04: Agent job entrypoint + executor refactor (Risk: MEDIUM)  
**Goal:** Agent job container runs `query()` with `McpHttpServerConfig`; orchestrator switches from in-process to ACA Job dispatch.
- Add `src/execution/agent-job.ts` — the entrypoint script run inside the job container (reads job env, calls `query()` with MCP HTTP configs, writes `result.json`)
- Refactor `createExecutor()` to dispatch ACA Job instead of calling `query()` directly
- Wire timeout → `jobs.stop()` cancellation
- The `ExecutionResult` type and all callers remain unchanged

### S05: `verify:m032` proof harness + deploy updates (Risk: LOW)
**Goal:** Contract + integration-level verification.
- `scripts/verify-m032.ts`: job spec has zero application secrets (pure-code), MCP auth middleware rejects 401, workspace path resolves to Azure Files mount, ACA Job execution status polling function works
- `bun run verify:m032` exits 0
- `deploy.sh` additions: storage account, file share, job definition, identity role assignment

---

## 7. Reuse Recommendations

- **Existing patterns to reuse:**
  - `src/execution/env.ts` — `buildAgentEnv()` shrinks further (agent job only needs `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`; all other env from job spec)
  - `src/jobs/workspace.ts` — `makeAuthUrl()`, `buildAuthFetchUrl()`, `enforceWritePolicy()` all reusable unchanged inside agent job
  - M029/S03 dry-run pattern for operational scripts
  - M031/S03 bearer token pattern for MCP auth middleware (same structure as the outgoing secret scan gate)
  - `scripts/verify-m031.ts` as template for `scripts/verify-m032.ts`

- **New modules to introduce:**
  - `src/jobs/aca-launcher.ts` — ACA Job management (start, poll, cancel) via Azure REST API
  - `src/execution/mcp/http-server.ts` — per-job HTTP MCP server factory using Hono + StreamableHTTP transport
  - `src/execution/agent-job.ts` — job container entrypoint script
  - `Dockerfile.agent` — separate Dockerfile for the agent job image (smaller: no Postgres, no wiki, no Hono server — just Bun + SDK + agent-job.ts)

---

## 8. Candidate Requirements

These are research findings, not automatically in scope:

| ID | Candidate | Status |
|----|-----------|--------|
| R-ISOLATION | Agent subprocess must never have application secrets via `/proc` or env | **Table stakes — must be in scope** |
| R-MCP-AUTH | MCP HTTP endpoints require per-job bearer auth | **Table stakes — must be in scope** |
| R-JOB-AUDIT | Each agent execution auditable as discrete ACA Job | **In scope** |
| R-LATENCY | ACA Job cold start must be measured and acceptable before architecture commits | **Research finding — validate in S01** |
| R-WORKSPACE-SMB | Git performance on Azure Files SMB acceptable | **Research finding — validate in S02** |
| R-AGENT-IMAGE | Separate slim agent job Docker image | **Implicit in architecture — should be explicit** |
| R-TIMEOUT-CANCEL | Timeout fires `jobs.stop()`, not just local abort | **In scope — needed for operational correctness** |

---

## 9. Open Questions for Planning

1. **Cold start threshold**: What latency is acceptable for PR review (async, so 15-20s fine) vs. `@kodiai` mentions (interactive, so 10s maybe tolerable)? The context suggests doing S01 early to validate. If cold start is consistently >20s for mentions, a split architecture may be needed (ACA Jobs for review; in-process for mentions but without full isolation).

2. **Agent image tag strategy**: Should the orchestrator and agent job use the same Docker image (orchestrator entrypoint `src/index.ts`, agent entrypoint `src/execution/agent-job.ts`) or separate images? Using one image reduces CI complexity but the image is larger. Using separate images allows a minimal agent image but adds a separate build step.

3. **`DefaultAzureCredential` vs raw IMDS**: Test whether `@azure/identity` works with Bun before committing to it. If it does, use it — it handles managed identity, service principal, and local dev credential chains automatically. If not, the raw IMDS approach is well-understood.

4. **ACA environment internal networking**: Confirm the internal FQDN pattern for ACA container apps (`<app-name>.internal.<env-name>.<region>.azurecontainerapps.io`) is correct for the `cae-kodiai` environment before planning the MCP base URL injection.

---

## 10. Summary of Strategic Direction

**What to prove first:** Cold start latency (S01). This determines whether the architecture is acceptable for mention handling or if a split approach is needed.

**Natural slice boundaries:**
- Infrastructure (S01) — independent of app code changes
- Workspace (S02) — depends on S01 (need the job container to test Azure Files)
- MCP HTTP server (S03) — mostly independent of S01/S02, can parallelize with S02
- Executor refactor (S04) — depends on S01 (ACA launcher), S02 (workspace), S03 (MCP HTTP)
- Verification (S05) — depends on all prior slices

**The critical invariant:** `ExecutionContext` → `ExecutionResult` interface must remain unchanged across the refactor. All 3 callers (`review.ts`, `mention.ts`) call `executor.execute(context)` — they cannot see the infrastructure change. The `createExecutor()` factory absorbs the complexity.

**Lowest-risk proof:** A unit test that constructs the job spec JSON (env vars, container config) and asserts no application secret names appear in the serialized spec. This is deterministic, requires no Azure infra, and constitutes the core contract guarantee of R-ISOLATION. This proof should be in S01's harness and carried through to `verify:m032`.
