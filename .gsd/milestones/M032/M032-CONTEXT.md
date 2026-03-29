# M032: Agent Process Isolation — Ephemeral ACA Job Sandbox

**Gathered:** 2026-03-29
**Status:** Queued — pending auto-mode execution

## Project Description

Kodiai is a GitHub App running a Claude Code agent (via `@anthropic-ai/claude-agent-sdk`) as part of PR reviews and @mention responses. The agent is invoked via `executor.execute()` in `src/execution/executor.ts`, which calls the SDK's `query()` function. The SDK spawns a child process (`cli.js`) using `child_process.spawn`. That child process runs inside the same Linux container as the main Bun HTTP server.

## Why This Milestone

M031 added an environment allowlist (`buildAgentEnv()`) to filter what secrets are passed to the agent subprocess. This is necessary but insufficient.

**Confirmed attack path — two components:**

1. **Prompt injection → code execution is assumed given**: Obfuscating prompts or chaining enough manipulated context will eventually produce Bash tool execution inside the agent. Treat code execution as a permanent given, not a variable to prevent.

2. **`/proc/<ppid>/environ` leaks full parent env**: The agent subprocess's parent is the Bun HTTP server (PID 1 in the Azure Container Apps container). On Linux, `/proc/<pid>/environ` is readable by any process with the same UID. The child process reads `/proc/1/environ` and obtains `DATABASE_URL`, `GITHUB_PRIVATE_KEY`, `SLACK_BOT_TOKEN`, `ANTHROPIC_API_KEY`, and all other secrets — bypassing `buildAgentEnv()` entirely.

**Verified mitigations that do NOT work in Azure Container Apps:**
- `bwrap` (bubblewrap) is installed but requires user namespace capabilities not available in ACA containers
- The SDK's `sandbox: { enabled: true }` is a software permission check — it passes a settings flag to the spawned process, not an OS-level namespace. Confirmed from SDK source.
- Seccomp filtering is complex and not reliably available in ACA

**The only fix:** Run the agent in a process that genuinely never had access to application secrets — an ephemeral Azure Container Apps Job spawned with a restricted set of env vars.

## User-Visible Outcome

### When this milestone is complete:

- A user asking `@kodiai what is your DATABASE_URL` inside a prompt-injected context gets nothing — because the agent job process never had `DATABASE_URL` in its environment, in `/proc`, or anywhere on its filesystem
- GitHub comments, reviews, and Slack responses continue working exactly as before (MCP servers run in orchestrator, agent calls them over HTTP)
- Agent jobs appear in the Azure portal as ACA Job executions with per-invocation audit trails
- `bun run verify:m032` exits 0 with checks confirming the job spec contains no application secrets

### Entry point / environment

- Entry point: GitHub webhook → mention/review handler → `executor.execute()` → spawns ACA Job
- Environment: Azure Container Apps (production), Azure Files share for workspace
- Live dependencies: Azure Container Apps Jobs API, Azure Files, GitHub API (via MCP in orchestrator), Anthropic API (from within the job)

## Completion Class

- Contract complete means: unit tests prove the job spec has zero application secrets; MCP HTTP auth middleware blocks unauthenticated requests; `verify:m032` passes
- Integration complete means: a real ACA Job is spawned and completes a `query()` call; orchestrator reads `result.json` from shared storage; the agent can call MCP HTTP endpoints in the orchestrator
- Operational complete means: deploy to production; smoke test a live @kodiai mention through the full ACA Job path; confirm no secrets visible in job execution environment

## Final Integrated Acceptance

- An @kodiai mention triggers an ACA Job execution visible in Azure portal; the job completes and the response is posted to GitHub
- Inside the job, `cat /proc/1/environ` returns only the job's own env (no `DATABASE_URL`, no `GITHUB_PRIVATE_KEY`)
- If the MCP HTTP endpoint is called without the bearer token, it returns 401 and the agent cannot publish
- `bun run verify:m032` exits 0 across all checks

## Risks and Unknowns

- **ACA Job cold start latency** — Job startup adds latency per invocation. ACA Jobs don't have warm instances. Estimate 5-15s. May be unacceptable for interactive mentions. Mitigation: keep the agent image small, pre-installed dependencies. Worth measuring in S01/S02 before committing to the full architecture.
- **Workspace path sharing via Azure Files** — Azure Files is SMB-based; mount performance for git operations may be slower than local tmpfs. Unknown until tested. Fallback: pass workspace as a tar archive via job env var (for small repos only).
- **MCP HTTP transport security** — MCP HTTP endpoints in the orchestrator must be on an internal network path not reachable externally. ACA supports internal-only ingress per container app. The bearer token for MCP must be short-lived and per-job.
- **Job execution timeout and cancellation** — Current timeout is via `AbortController` on the `query()` call. With ACA Jobs, cancellation becomes a Job API cancel call. The orchestrator's `timeoutSeconds` enforcement needs to be wired to the job lifecycle.
- **Result polling complexity** — Replacing `await executor.execute()` (synchronous) with a poll loop changes the execution model significantly. The job queue's concurrency model (`jobs/queue.ts`) may need adjustment.
- **generate.ts left as-is** — `generate.ts` uses the agent SDK with `allowedTools: []`, so no Bash/Read tools are available. Risk is lower but not zero (a future tool addition could introduce the same vulnerability). Accepted for this milestone; scope for M033 if needed.

## Existing Codebase / Prior Art (verified against current state)

- `src/execution/executor.ts` — `createExecutor()` calls `query()` synchronously and returns `ExecutionResult`. The `env: { ...buildAgentEnv() }` option passes the filtered env to the SDK child process. This file will be split: execution dispatch moves to an ACA Job launcher; result awaiting replaces the `for await` SDK loop.
- `src/jobs/workspace.ts` — `createWorkspaceManager()` creates a temp dir via `mkdtemp(join(tmpdir(), "kodiai-"))`. Workspace dir is local to the Bun container. Needs to switch to Azure Files mount path. Verified: `cleanup()` uses `rm` — unchanged semantics, different base path.
- `src/jobs/types.ts` — `Workspace` interface has `dir`, `cleanup()`, `token?`. The `token` field stays; it's now passed to the ACA Job spec rather than read from `.git/config`.
- `src/execution/mcp/index.ts` — `buildMcpServers()` returns `Record<string, McpServerConfig>` where each entry is a `McpSdkServerConfigWithInstance` (in-process SDK servers). These need to change to `McpHttpServerConfig` entries pointing at the orchestrator's MCP HTTP endpoint.
- `src/execution/mcp/comment-server.ts`, `inline-review-server.ts`, `review-comment-thread-server.ts`, `issue-comment-server.ts`, `ci-status-server.ts`, `issue-label-server.ts`, `checkpoint-server.ts` — Seven MCP servers total. All use `createSdkMcpServer()`. Need to be exposed over HTTP from the orchestrator via a new `src/execution/mcp/http-server.ts` module.
- `deploy.sh` — Manages ACA container via `az containerapp update`. Needs additions: Azure Storage account creation, Azure Files share, ACA Jobs environment definition, job image registration. The existing update pattern is `az containerapp update` — same pattern applies for adding storage mounts.
- SDK `McpHttpServerConfig` — `{ type: 'http', url: string, headers?: Record<string, string> }` — confirmed in `sdk.d.ts`. The agent can call MCP servers over HTTP natively; no SDK changes needed.
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` — SDK spawns a child process via `child_process.spawn`. Confirmed. The `env` option is passed to the spawned process. This will move to the ACA Job's own env — the orchestrator never calls `query()` again.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — append-only register; read it during planning.

## Relevant Requirements

No existing validated requirements directly cover process-level isolation. This milestone introduces new security requirements:
- R-ISOLATION: Agent subprocess must never have access to application secrets, even via `/proc` filesystem
- R-MCP-AUTH: MCP HTTP endpoints exposed by orchestrator must require per-job bearer auth
- R-JOB-AUDIT: Each agent execution must be auditable as a discrete ACA Job execution

## Scope

### In Scope

- Azure Container Apps Job launcher replacing the synchronous `executor.execute()` → `query()` path
- Azure Files share for workspace sharing between orchestrator and agent job containers
- MCP HTTP server in orchestrator: exposes all 7 MCP servers over authenticated HTTP (per-job bearer token)
- Agent job container: runs `query()` with `McpHttpServerConfig` pointing at orchestrator MCP endpoint
- Result passing: agent job writes `result.json` to workspace dir; orchestrator polls ACA Job API until exit, reads result
- `CLAUDE.md` security policy passed as part of job spec (written to workspace by agent job before `query()`)
- Outgoing secret scan remains in the MCP servers in the orchestrator (unchanged from M031)
- `verify:m032` proof harness: job spec has no application secrets, MCP auth middleware rejects unauthorized, workspace path is on Azure Files mount
- `deploy.sh` updates: Azure Storage account, Azure Files share, ACA Job definition
- `buildAgentEnv()` updated to remove all vars except `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` (since job container has no other env to pass anyway)

### Out of Scope / Non-Goals

- `generate.ts` agent SDK path — lower risk (`allowedTools: []`), deferred
- Network egress filtering from the agent job container — infrastructure layer
- Sandboxing the agent job at the filesystem level (only the process/env isolation is in scope)
- Encrypting the Azure Files share contents — the share holds ephemeral workspaces, not persistent secrets
- Migrating the Slack write-mode path — same executor pattern, included in the same refactor

## Technical Constraints

- Must not break write-mode push operations (workspace token must still reach push functions; it's now passed via job result or carried through the job spec)
- ACA Jobs API requires Azure CLI / Azure SDK — need to pick the right client library for Bun
- MCP HTTP endpoint must not be externally reachable — ACA internal ingress only
- Agent job image must be pre-built and pushed to ACR; the job spec references it by image tag
- Azure Files share must be mounted at the same path in both containers (`/mnt/kodiai-workspaces/`)
- Job timeout enforcement: orchestrator must cancel the ACA Job if `timeoutSeconds` elapses before job exit

## Integration Points

- **Azure Container Apps Jobs API** — orchestrator creates/monitors/cancels jobs via `az containerapp job` CLI or Azure REST API
- **Azure Files** — shared workspace mount; orchestrator creates dirs, agent job reads/writes, orchestrator reads `result.json`
- **Azure Container Registry** — agent job image pushed to same `kodiairegistry`; new image tag (e.g., `kodiai-agent:latest`)
- **Orchestrator MCP HTTP server** — new internal HTTP endpoint, path-based routing for each MCP server (e.g., `/internal/mcp/github_comment`)
- **Anthropic API** — called directly from the agent job via `CLAUDE_CODE_OAUTH_TOKEN`

## Open Questions

- **Azure Files mount performance** — git operations on SMB mounts can be 2-5x slower than local tmpfs. If unacceptable, alternative is to clone locally within the job and transfer only `result.json` back (no workspace sharing needed for read-only jobs).
- **ACA Jobs SDK for Bun** — Azure SDK for JS (`@azure/arm-appcontainers`) supports Container Apps Jobs. Verify it works with Bun before committing to it in S01. Fallback: `az` CLI subprocess.
- **Per-job MCP bearer token generation** — needs a short-lived token generator. Simple: `crypto.randomBytes(32).toString('hex')` scoped to a single job ID. Stored in a `Map<jobId, token>` in the orchestrator (in-memory, cleaned up on job completion).
- **Write-mode workspace token** — for write-mode jobs that push commits, the installation token must reach the push functions. Currently carried as `Workspace.token`. In the new model, the token is in the ACA Job env as `GITHUB_INSTALLATION_TOKEN` (not an application secret — it's a scoped per-repo token with short TTL). This is acceptable since the token scope is limited to the target repo.
