---
id: S03
parent: M032
milestone: M032
provides:
  - src/execution/agent-entrypoint.ts — runnable ACA job container entrypoint with full env validation, MCP config construction, SDK invocation, and result.json write
  - cancelAcaJob() in aca-launcher.ts — job cancellation on timeout path
  - acaResourceGroup and acaJobName config fields with zero-config defaults
  - Dockerfile.agent — agent job container image definition
  - createExecutor() fully refactored to ACA dispatch path with mcpJobRegistry dependency
  - index.ts wired: mcpJobRegistry declared before createExecutor, both passed as deps
requires:
  - slice: S01
    provides: launchAcaJob, pollUntilComplete, buildAcaJobSpec, readJobResult, createAzureFilesWorkspaceDir from src/jobs/
  - slice: S02
    provides: McpJobRegistry and createMcpHttpRoutes from src/execution/mcp/
affects:
  - S04 — proof harness needs ACA dispatch path checks; deploy.sh Dockerfile.agent build is a prerequisite for live job demo
key_files:
  - src/execution/agent-entrypoint.ts
  - src/execution/agent-entrypoint.test.ts
  - src/execution/executor.ts
  - src/execution/executor.test.ts
  - src/index.ts
  - src/jobs/aca-launcher.ts
  - src/jobs/aca-launcher.test.ts
  - src/config.ts
  - Dockerfile.agent
  - deploy.sh
key_decisions:
  - cancelAcaJob wraps az --output none and returns void, logs at info after completion
  - acaResourceGroup/acaJobName default to deploy.sh provisioned names so zero-config deployments work
  - Dockerfile.agent has no EXPOSE — ACA job containers have no inbound network ports
  - EntrypointDeps injection pattern: queryFn/writeFileFn/readFileFn/exitFn injectable via Partial<EntrypointDeps>; exitFn return type is never
  - MCP_SERVER_NAMES exported as readonly const for cross-test assertion without duplication
  - createTestableExecutor pattern: injectable launchFn/pollFn/cancelFn/readResultFn/createWorkspaceDirFn avoids module mocking
  - config passed as AppConfig dep to createExecutor (not read from env at execute time)
  - AbortController/setTimeout removed — pollUntilComplete+cancelAcaJob own timeout
  - mcpBearerToken = 32 bytes via crypto.getRandomValues → 64 hex chars, scoped to one job TTL
patterns_established:
  - Injectable deps pattern for process-exit code testing without module mocking (EntrypointDeps with exitFn: never)
  - createTestableExecutor factory pattern for per-invocation injectable I/O fns in ACA dispatch tests
  - Per-job bearer token lifecycle: generate → register in registry → use for job → unregister on completion/timeout/failure
observability_surfaces:
  - cancelAcaJob logs at info level after successful cancellation (resourceGroup, jobName, executionName)
  - executor.ts logs launchAcaJob result (executionName) and poll outcome (status, durationMs) at info level
  - agent-entrypoint.ts logs env-var validation failures and config parse errors to console.error with full context before exit(1)
drill_down_paths:
  - .gsd/milestones/M032/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M032/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M032/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-29T19:18:39.882Z
blocker_discovered: false
---

# S03: Agent Job Entrypoint + Executor Refactor

**Wired S01 (ACA launcher) and S02 (MCP HTTP registry) into the execution path: added agent-entrypoint.ts, refactored createExecutor() to dispatch ACA jobs, added cancelAcaJob(), Dockerfile.agent, acaResourceGroup/acaJobName config fields, and mcpJobRegistry dependency threading.**

## What Happened

S03 delivered three interconnected changes that complete the orchestrator-to-ACA-job dispatch path.

**T01 — Config, cancel, and container image scaffolding:** Added `cancelAcaJob()` to aca-launcher.ts as a thin `az containerapp job execution stop` wrapper with info-level logging. Added `acaResourceGroup` (default 'rg-kodiai') and `acaJobName` (default 'caj-kodiai-agent') to configSchema and loadConfig(), reading from `ACA_RESOURCE_GROUP` and `ACA_JOB_NAME` env vars. Created `Dockerfile.agent` — structurally identical to the main Dockerfile except CMD is `bun run src/execution/agent-entrypoint.ts` and there is no EXPOSE (no incoming ports on a job container). Fixed deploy.sh to pass `--file Dockerfile.agent` to the agent image build. Updated AppConfig stubs in 10 locations (2 test files + 8 scripts) to satisfy the `bun run tsc --noEmit` exit-0 gate. All 21 aca-launcher tests pass.

**T02 — ACA job container entrypoint:** Implemented `src/execution/agent-entrypoint.ts` with all seven responsibilities: env-var validation with exit(1), agent-config.json read/parse with exit(1), CLAUDE.md write via `buildSecurityClaudeMd()`, MCP server config construction for all 7 named servers (pointing at `${MCP_BASE_URL}/internal/mcp/${serverName}` with bearer auth), SDK `query()` invocation with `bypassPermissions` + `settingSources:['project']`, SDKResultMessage capture, and `result.json` write in ExecutionResult shape (with `{ conclusion: 'error', errorMessage }` fallback). Used an injectable `EntrypointDeps` pattern (`queryFn`, `writeFileFn`, `readFileFn`, `exitFn: (code) => never`) so tests exercise all 13 paths without module mocking or live process.exit calls. `MCP_SERVER_NAMES` exported as a readonly const for cross-test assertion. 13 tests, 60 expect() calls, all pass.

**T03 — Executor refactor + index.ts wiring:** Replaced the inline SDK `query()` streaming loop in `createExecutor()` with the full ACA job dispatch sequence: generate 32-byte hex bearer token → register per-job MCP server factories in registry under token with TTL = (timeoutSeconds + 60) * 1000 → create Azure Files workspace dir → write `prompt.txt` and `agent-config.json` → `buildAcaJobSpec` → `launchAcaJob` → `pollUntilComplete` → `cancelAcaJob` on timeout → `readJobResult` → merge `published`/`publishEvents` from onPublish closure into result → `registry.unregister(mcpBearerToken)`. Removed `AbortController`/`setTimeout` timeout mechanism (timeout now owned by `pollUntilComplete` + `cancelAcaJob`). Added `config: AppConfig` and `mcpJobRegistry: McpJobRegistry` to the deps type. Updated index.ts to declare `mcpJobRegistry` before `createExecutor` and pass both. Used `createTestableExecutor` injectable pattern for all 14 new dispatch tests; retained 8 existing `buildSecurityClaudeMd` tests. 22 total tests, 50 expect() calls, all pass.

Slice-level verification: 56 tests across all three test files, 0 failures, 159 expect() calls. `bun run tsc --noEmit` exits 0.

## Verification

bun test ./src/jobs/aca-launcher.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts — 56 pass, 0 fail, 159 expect() calls. bun run tsc --noEmit — exit 0.

## Requirements Advanced

- R009 — No direct requirement advancement — S03 is internal infrastructure.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

T01: Updated 8 additional AppConfig stubs in scripts beyond the 2 test files in the plan — required by the tsc exit-0 gate. T02: Used EntrypointDeps injection pattern instead of process.exit spy — avoids Bun module-mock fragility; exitFn has return type never. T03: Used createTestableExecutor injectable fns pattern instead of Bun module mocking — per-invocation isolation; AppConfig passed as dep to createExecutor rather than read from process.env at execute time.

## Known Limitations

The ACA job dispatch path requires live Azure infrastructure (ACA Job, Azure Files mount) to exercise end-to-end. Unit tests cover all branching paths with stubs. The smoke test in scripts/test-aca-job.ts (from S01) can be run against real infrastructure to close this gap. The Dockerfile.agent has not been built and pushed in this slice — that happens during S04 deploy verification.

## Follow-ups

S04 needs to add verify:m032 proof harness checks covering: (a) ACA job spec has no APPLICATION_SECRET_NAMES in env array, (b) agent-entrypoint.ts env isolation contract, (c) deploy.sh idempotency. Dockerfile.agent must be built and pushed to ACR before the end-to-end demo (ACA Job appears in Azure portal) can be validated.

## Files Created/Modified

- `src/execution/agent-entrypoint.ts` — New: ACA job container entrypoint — env validation, config read, CLAUDE.md write, SDK invoke, result.json write
- `src/execution/agent-entrypoint.test.ts` — New: 13 unit tests for agent-entrypoint covering all env, config, SDK, and error paths
- `src/execution/executor.ts` — Refactored: SDK query() loop replaced with ACA job dispatch; AbortController removed; config and mcpJobRegistry added to deps
- `src/execution/executor.test.ts` — Updated: 14 new ACA dispatch tests added; 8 buildSecurityClaudeMd tests retained
- `src/index.ts` — Updated: mcpJobRegistry declared before createExecutor; both config and mcpJobRegistry passed as deps
- `src/jobs/aca-launcher.ts` — Updated: cancelAcaJob() added
- `src/jobs/aca-launcher.test.ts` — Updated: cancelAcaJob tests added
- `src/config.ts` — Updated: acaResourceGroup and acaJobName fields added to configSchema and loadConfig
- `Dockerfile.agent` — New: agent job container image — same base as Dockerfile, CMD is agent-entrypoint.ts, no EXPOSE
- `deploy.sh` — Updated: agent image build uses --file Dockerfile.agent
- `src/routes/slack-events.test.ts` — Updated: AppConfig stubs extended with acaResourceGroup and acaJobName
- `src/routes/slack-commands.test.ts` — Updated: AppConfig stubs extended with acaResourceGroup and acaJobName
