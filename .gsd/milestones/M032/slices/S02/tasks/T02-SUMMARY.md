---
id: T02
parent: S02
milestone: M032
provides: []
requires: []
affects: []
key_files: ["src/jobs/aca-launcher.ts", "src/jobs/aca-launcher.test.ts", "src/config.ts", "src/index.ts", "scripts/test-aca-job.ts"]
key_decisions: ["Mount createMcpHttpRoutes at app.route("/", ...) not "/internal" — sub-app already defines routes with /internal prefix", "AppConfig stubs in scripts/tests need explicit mcpInternalBaseUrl and acaJobImage fields — Zod .default fills env-parsed output but TypeScript literal stubs must include all fields"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test ./src/jobs/aca-launcher.test.ts: 18 pass, 0 fail. bun run tsc --noEmit: exits 0 (clean)."
completed_at: 2026-03-29T18:43:51.584Z
blocker_discovered: false
---

# T02: Wired MCP_BASE_URL into ACA job specs, added mcpInternalBaseUrl/acaJobImage config fields, and mounted MCP HTTP routes in index.ts

> Wired MCP_BASE_URL into ACA job specs, added mcpInternalBaseUrl/acaJobImage config fields, and mounted MCP HTTP routes in index.ts

## What Happened
---
id: T02
parent: S02
milestone: M032
key_files:
  - src/jobs/aca-launcher.ts
  - src/jobs/aca-launcher.test.ts
  - src/config.ts
  - src/index.ts
  - scripts/test-aca-job.ts
key_decisions:
  - Mount createMcpHttpRoutes at app.route("/", ...) not "/internal" — sub-app already defines routes with /internal prefix
  - AppConfig stubs in scripts/tests need explicit mcpInternalBaseUrl and acaJobImage fields — Zod .default fills env-parsed output but TypeScript literal stubs must include all fields
duration: ""
verification_result: passed
completed_at: 2026-03-29T18:43:51.584Z
blocker_discovered: false
---

# T02: Wired MCP_BASE_URL into ACA job specs, added mcpInternalBaseUrl/acaJobImage config fields, and mounted MCP HTTP routes in index.ts

**Wired MCP_BASE_URL into ACA job specs, added mcpInternalBaseUrl/acaJobImage config fields, and mounted MCP HTTP routes in index.ts**

## What Happened

Added mcpBaseUrl: string to BuildAcaJobSpecOpts and injected MCP_BASE_URL into the job env array. Added two new aca-launcher tests. Added mcpInternalBaseUrl and acaJobImage to configSchema and loadConfig. In index.ts, imported createMcpJobRegistry/createMcpHttpRoutes, created mcpJobRegistry after the executor, and mounted routes at app.route("/", createMcpHttpRoutes(mcpJobRegistry, logger)) — root mount required because the sub-app already owns the /internal prefix. Fixed 10 AppConfig literal stubs across scripts and test files (Zod .default fills runtime defaults but TypeScript structural types still require all fields in literal objects), plus two BuildAcaJobSpecOpts call sites in scripts/test-aca-job.ts.

## Verification

bun test ./src/jobs/aca-launcher.test.ts: 18 pass, 0 fail. bun run tsc --noEmit: exits 0 (clean).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/jobs/aca-launcher.test.ts` | 0 | ✅ pass | 23ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 8000ms |


## Deviations

Mounted routes at app.route(\"/\", ...) not app.route(\"/internal\", ...) — sub-app already owns /internal prefix. Fixed 10 AppConfig stubs across scripts/tests (plan predicted Zod defaults would prevent this). Fixed two call sites in test-aca-job.ts, not one.

## Known Issues

None.

## Files Created/Modified

- `src/jobs/aca-launcher.ts`
- `src/jobs/aca-launcher.test.ts`
- `src/config.ts`
- `src/index.ts`
- `scripts/test-aca-job.ts`


## Deviations
Mounted routes at app.route(\"/\", ...) not app.route(\"/internal\", ...) — sub-app already owns /internal prefix. Fixed 10 AppConfig stubs across scripts/tests (plan predicted Zod defaults would prevent this). Fixed two call sites in test-aca-job.ts, not one.

## Known Issues
None.
