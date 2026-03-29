---
id: S02
parent: M032
milestone: M032
provides:
  - createMcpJobRegistry() — per-job bearer token registry with TTL, ready for S03 to call .register(token, factories) before job dispatch and .unregister(token) on completion
  - createMcpHttpRoutes(registry, logger?) — Hono app at /internal/mcp/:serverName, mounted and listening in orchestrator
  - MCP_BASE_URL in ACA job env — job can call http://{MCP_BASE_URL}/internal/mcp/{serverName} with Authorization: Bearer {token}
  - mcpInternalBaseUrl and acaJobImage in AppConfig — S03 can read config.mcpInternalBaseUrl to pass to buildAcaJobSpec
requires:
  []
affects:
  - S03 — must wire MCP server factories into registry before job dispatch, expose registry to executor path
key_files:
  - src/execution/mcp/http-server.ts
  - src/execution/mcp/http-server.test.ts
  - src/jobs/aca-launcher.ts
  - src/jobs/aca-launcher.test.ts
  - src/config.ts
  - src/index.ts
key_decisions:
  - Per-request fresh transport+server pattern required by MCP stateless mode invariant (_hasHandledRequest flag)
  - enableJsonResponse:true forces JSON vs SSE — simpler for RPC clients and test assertions
  - MCP sub-app mounted at root (app.route('/')) because it owns its own /internal prefix
  - MCP_BASE_URL is not in APPLICATION_SECRET_NAMES — it is a non-secret URL, no security guard fires
  - AppConfig Zod .default() fills runtime-parsed output but TypeScript structural types require explicit fields in literal stubs
patterns_established:
  - Per-request fresh MCP transport+server: always call factory() inside the HTTP handler, never reuse transport or server instances across requests in stateless mode
  - Hono sub-app prefix ownership: if createFooRoutes() mounts at /prefix/..., call app.route('/', createFooRoutes(...)) at root, not app.route('/prefix', ...)
observability_surfaces:
  - logger.warn({ tokenPrefix: token?.slice(0, 8) }, 'MCP HTTP: unauthorized') — logged on every 401, includes first 8 chars of token for tracing without exposing full token
  - logger.warn({ serverName, tokenPrefix }, 'MCP HTTP: server not found') — logged on 404
drill_down_paths:
  - milestones/M032/slices/S02/tasks/T01-SUMMARY.md
  - milestones/M032/slices/S02/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-29T18:46:28.833Z
blocker_discovered: false
---

# S02: MCP HTTP Server in Orchestrator

**Built authenticated MCP HTTP server (per-job bearer token registry + stateless Hono routes) and integrated it into the orchestrator startup and ACA job spec builder.**

## What Happened

S02 delivered the internal MCP HTTP server that lets the isolated ACA agent job call MCP tools without holding application secrets.

**T01 — http-server.ts:** Created `src/execution/mcp/http-server.ts` with two exports. `createMcpJobRegistry()` is a `Map<string, McpJobEntry>`-backed registry keyed by per-job bearer token. Each entry holds a `Record<string, () => McpSdkServerConfigWithInstance>` (server name → factory) and an `expiresAt` timestamp for lazy TTL expiry. `createMcpHttpRoutes(registry, logger?)` returns a Hono app with a single `app.all("/internal/mcp/:serverName", ...)` handler. The handler validates the `Authorization: Bearer` token against the registry, looks up the factory by server name, then creates a **fresh** `WebStandardStreamableHTTPServerTransport` (sessionIdGenerator: undefined, enableJsonResponse: true) and calls `serverConfig.instance.connect(transport)` on each request. The per-request fresh-instance pattern is required by the SDK: the `_hasHandledRequest` flag on the transport prevents reuse, and `McpServer.connect()` registers tool handlers that can't be re-registered on an existing server instance. `enableJsonResponse: true` forces JSON responses (vs SSE) for simpler RPC clients. Tests discovered that MCP POST requests require `Accept: application/json, text/event-stream` per the MCP spec — the test helper includes this header. 10 tests pass: registry lifecycle (hasToken, register, unregister, getFactory, TTL expiry) and all 5 HTTP scenarios (no auth, wrong token, unknown server, valid MCP initialize → 200 with result, unregister → subsequent 401).

**T02 — Integration:** Added `mcpBaseUrl: string` to `BuildAcaJobSpecOpts` and injected `MCP_BASE_URL` into the ACA job env array (not in APPLICATION_SECRET_NAMES — not a secret, no guard fires). Added `mcpInternalBaseUrl` and `acaJobImage` to `configSchema` with Zod `.default("")` and `loadConfig` reads from `MCP_INTERNAL_BASE_URL`/`ACA_JOB_IMAGE` env vars. In `index.ts`, the registry is created after the executor and mounted at `app.route("/", createMcpHttpRoutes(mcpJobRegistry, logger))` — root mount is required because the sub-app already owns the `/internal` prefix (mounting at `/internal` would double the prefix). Fixed 10 AppConfig literal stubs across scripts/test files where Zod defaults fill runtime-parsed output but TypeScript structural typing still requires all fields in object literals. 18 aca-launcher tests pass.

## Verification

Slice-level verification: `bun test ./src/execution/mcp/http-server.test.ts` → 10 pass, 0 fail. `bun test ./src/jobs/aca-launcher.test.ts` → 18 pass, 0 fail. `bun run tsc --noEmit` → exits 0 (clean).

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

T01: Added enableJsonResponse:true (not in plan sketch) — avoids SSE negotiation complexity for RPC clients. Added Accept: application/json, text/event-stream to test helper after hitting 406 from MCP spec guard (spec requirement, not in plan). T02: Root mount at app.route("/", ...) rather than app.route("/internal", ...) — sub-app owns its own prefix. Fixed 10 AppConfig stubs across codebase (plan predicted Zod defaults would prevent this — they do at runtime but not in TypeScript literal types). Fixed two call sites in test-aca-job.ts, not one.

## Known Limitations

mcpJobRegistry in index.ts is local variable — S03 must wire MCP server factories via the registry reference passed to createMcpHttpRoutes. The registry is not exported from index.ts; S03 should receive it via dependency injection or module-level export (to be decided in S03 planning).

## Follow-ups

S03 needs to: (1) register MCP server factories into mcpJobRegistry before dispatching each ACA job, (2) pass MCP_BASE_URL from config.mcpInternalBaseUrl to buildAcaJobSpec, (3) generate per-job bearer token (crypto.randomBytes(32).hex()) and register/unregister it around the job lifetime. The registry reference must be exposed to the executor/job-dispatch path.

## Files Created/Modified

- `src/execution/mcp/http-server.ts` — New file: createMcpJobRegistry() and createMcpHttpRoutes() — core MCP HTTP server module
- `src/execution/mcp/http-server.test.ts` — New file: 10 tests for registry lifecycle and HTTP auth/routing scenarios
- `src/jobs/aca-launcher.ts` — Added mcpBaseUrl to BuildAcaJobSpecOpts; injects MCP_BASE_URL into job env
- `src/jobs/aca-launcher.test.ts` — Added MCP_BASE_URL presence test and MCP_BASE_URL-not-in-APPLICATION_SECRET_NAMES test
- `src/config.ts` — Added mcpInternalBaseUrl and acaJobImage to configSchema with Zod defaults; reads from MCP_INTERNAL_BASE_URL and ACA_JOB_IMAGE env vars
- `src/index.ts` — Imports createMcpJobRegistry/createMcpHttpRoutes; creates mcpJobRegistry; mounts routes at app.route('/', ...)
- `scripts/test-aca-job.ts` — Fixed two BuildAcaJobSpecOpts call sites to include mcpBaseUrl; fixed AppConfig stub
