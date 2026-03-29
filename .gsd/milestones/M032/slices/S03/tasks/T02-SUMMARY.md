---
id: T02
parent: S03
milestone: M032
provides: []
requires: []
affects: []
key_files: ["src/execution/agent-entrypoint.ts", "src/execution/agent-entrypoint.test.ts"]
key_decisions: ["EntrypointDeps injection pattern: queryFn, writeFileFn, readFileFn, exitFn injectable via Partial<EntrypointDeps>; production callers pass nothing; test stubs inject directly", "exitFn return type is never; test stubs use return undefined as never to avoid actually calling process.exit", "MCP_SERVER_NAMES exported as readonly const so tests can assert against the canonical list without duplication"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test ./src/execution/agent-entrypoint.test.ts — 13 pass, 0 fail, 60 expect() calls. bun run tsc --noEmit — exit 0."
completed_at: 2026-03-29T19:09:30.860Z
blocker_discovered: false
---

# T02: Created agent-entrypoint.ts (ACA job container script) and 13 passing unit tests covering all env-var, config, SDK, and error paths

> Created agent-entrypoint.ts (ACA job container script) and 13 passing unit tests covering all env-var, config, SDK, and error paths

## What Happened
---
id: T02
parent: S03
milestone: M032
key_files:
  - src/execution/agent-entrypoint.ts
  - src/execution/agent-entrypoint.test.ts
key_decisions:
  - EntrypointDeps injection pattern: queryFn, writeFileFn, readFileFn, exitFn injectable via Partial<EntrypointDeps>; production callers pass nothing; test stubs inject directly
  - exitFn return type is never; test stubs use return undefined as never to avoid actually calling process.exit
  - MCP_SERVER_NAMES exported as readonly const so tests can assert against the canonical list without duplication
duration: ""
verification_result: passed
completed_at: 2026-03-29T19:09:30.860Z
blocker_discovered: false
---

# T02: Created agent-entrypoint.ts (ACA job container script) and 13 passing unit tests covering all env-var, config, SDK, and error paths

**Created agent-entrypoint.ts (ACA job container script) and 13 passing unit tests covering all env-var, config, SDK, and error paths**

## What Happened

Implemented src/execution/agent-entrypoint.ts with all 7 responsibilities from the task plan: env-var validation with exit(1), agent-config.json read/parse with exit(1), CLAUDE.md write via buildSecurityClaudeMd(), McpHttpServerConfig construction for all 7 MCP server names, SDK query() invocation with bypassPermissions + settingSources:['project'], SDKResultMessage collection, and result.json write with the ExecutionResult shape (including error fallback). Used an injectable EntrypointDeps pattern (optional partial parameter) so tests inject queryFn/writeFileFn/readFileFn/exitFn stubs without module mocking. Wrote 13 unit tests covering missing env vars (4 cases including CLAUDE_CODE_OAUTH_TOKEN fallback), missing/invalid config (2 cases), happy path (4 cases asserting CLAUDE.md ordering, MCP server construction, SDK params, result.json fields), and SDK error paths (2 cases). Fixed 6 tsc nullability errors in test file with non-null assertions following toBeDefined() guards.

## Verification

bun test ./src/execution/agent-entrypoint.test.ts — 13 pass, 0 fail, 60 expect() calls. bun run tsc --noEmit — exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/agent-entrypoint.test.ts` | 0 | ✅ pass | 132ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 8300ms |


## Deviations

Used EntrypointDeps injection pattern rather than process.exit spy — functionally equivalent but cleaner and avoids Bun module-mock fragility. exitFn is a first-class injectable with return type never.

## Known Issues

None.

## Files Created/Modified

- `src/execution/agent-entrypoint.ts`
- `src/execution/agent-entrypoint.test.ts`


## Deviations
Used EntrypointDeps injection pattern rather than process.exit spy — functionally equivalent but cleaner and avoids Bun module-mock fragility. exitFn is a first-class injectable with return type never.

## Known Issues
None.
