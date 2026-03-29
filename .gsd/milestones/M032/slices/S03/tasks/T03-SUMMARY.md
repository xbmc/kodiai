---
id: T03
parent: S03
milestone: M032
provides: []
requires: []
affects: []
key_files: ["src/execution/executor.ts", "src/execution/executor.test.ts", "src/index.ts"]
key_decisions: ["createTestableExecutor pattern: injectable launchFn/pollFn/cancelFn/readResultFn/createWorkspaceDirFn avoids module mocking fragility", "config passed as AppConfig dep to createExecutor (not read from env at execute time)", "AbortController/setTimeout removed — pollUntilComplete+cancelAcaJob own timeout now", "mcpBearerToken = 32 bytes via crypto.getRandomValues → 64 hex chars"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test ./src/execution/executor.test.ts — 22 pass, 0 fail, 50 expect() calls. bun run tsc --noEmit — exit 0. bun test ./src/jobs/aca-launcher.test.ts ./src/execution/agent-entrypoint.test.ts — 34 pass, 0 fail (no regressions)."
completed_at: 2026-03-29T19:15:47.117Z
blocker_discovered: false
---

# T03: Refactored createExecutor() to dispatch ACA jobs instead of running Agent SDK in-process, and wired mcpJobRegistry as dependency

> Refactored createExecutor() to dispatch ACA jobs instead of running Agent SDK in-process, and wired mcpJobRegistry as dependency

## What Happened
---
id: T03
parent: S03
milestone: M032
key_files:
  - src/execution/executor.ts
  - src/execution/executor.test.ts
  - src/index.ts
key_decisions:
  - createTestableExecutor pattern: injectable launchFn/pollFn/cancelFn/readResultFn/createWorkspaceDirFn avoids module mocking fragility
  - config passed as AppConfig dep to createExecutor (not read from env at execute time)
  - AbortController/setTimeout removed — pollUntilComplete+cancelAcaJob own timeout now
  - mcpBearerToken = 32 bytes via crypto.getRandomValues → 64 hex chars
duration: ""
verification_result: passed
completed_at: 2026-03-29T19:15:47.118Z
blocker_discovered: false
---

# T03: Refactored createExecutor() to dispatch ACA jobs instead of running Agent SDK in-process, and wired mcpJobRegistry as dependency

**Refactored createExecutor() to dispatch ACA jobs instead of running Agent SDK in-process, and wired mcpJobRegistry as dependency**

## What Happened

Rewrote createExecutor() in executor.ts: replaced the SDK query() streaming loop with the full ACA job dispatch path (generate bearer token → register MCP servers in registry → create Azure Files workspace dir → write prompt.txt/agent-config.json → buildAcaJobSpec → launchAcaJob → pollUntilComplete → cancelAcaJob on timeout → readJobResult → merge published/publishEvents → unregister token). Removed AbortController/setTimeout timeout mechanism and buildAgentEnv import. Added config: AppConfig and mcpJobRegistry: McpJobRegistry to deps signature. Updated index.ts to declare mcpJobRegistry before createExecutor and pass both config and mcpJobRegistry. Wrote 14 new tests using a createTestableExecutor injectable pattern covering all dispatch paths; kept 8 existing buildSecurityClaudeMd tests.

## Verification

bun test ./src/execution/executor.test.ts — 22 pass, 0 fail, 50 expect() calls. bun run tsc --noEmit — exit 0. bun test ./src/jobs/aca-launcher.test.ts ./src/execution/agent-entrypoint.test.ts — 34 pass, 0 fail (no regressions).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/executor.test.ts` | 0 | ✅ pass | 276ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 123500ms |
| 3 | `bun test ./src/jobs/aca-launcher.test.ts ./src/execution/agent-entrypoint.test.ts` | 0 | ✅ pass | 128ms |


## Deviations

Used createTestableExecutor inline pattern with injectable fns instead of module mocking — avoids Bun module mock fragility. AppConfig passed as dep to createExecutor rather than reading process.env at execute time.

## Known Issues

None.

## Files Created/Modified

- `src/execution/executor.ts`
- `src/execution/executor.test.ts`
- `src/index.ts`


## Deviations
Used createTestableExecutor inline pattern with injectable fns instead of module mocking — avoids Bun module mock fragility. AppConfig passed as dep to createExecutor rather than reading process.env at execute time.

## Known Issues
None.
