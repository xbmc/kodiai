---
id: T01
parent: S02
milestone: M032
provides: []
requires: []
affects: []
key_files: ["src/execution/mcp/http-server.ts", "src/execution/mcp/http-server.test.ts", ".gsd/KNOWLEDGE.md"]
key_decisions: ["enableJsonResponse:true on WebStandardStreamableHTTPServerTransport for predictable JSON responses in stateless mode", "Per-request fresh transport+server pattern — factory called on every HTTP request to avoid _hasHandledRequest reuse error"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test ./src/execution/mcp/http-server.test.ts: 10 pass, 0 fail. bun run tsc --noEmit: exits 0 (clean)."
completed_at: 2026-03-29T18:38:45.404Z
blocker_discovered: false
---

# T01: Built MCP HTTP server module: per-job bearer-token registry and stateless Hono route handler using fresh per-request transport+server instances

> Built MCP HTTP server module: per-job bearer-token registry and stateless Hono route handler using fresh per-request transport+server instances

## What Happened
---
id: T01
parent: S02
milestone: M032
key_files:
  - src/execution/mcp/http-server.ts
  - src/execution/mcp/http-server.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - enableJsonResponse:true on WebStandardStreamableHTTPServerTransport for predictable JSON responses in stateless mode
  - Per-request fresh transport+server pattern — factory called on every HTTP request to avoid _hasHandledRequest reuse error
duration: ""
verification_result: passed
completed_at: 2026-03-29T18:38:45.404Z
blocker_discovered: false
---

# T01: Built MCP HTTP server module: per-job bearer-token registry and stateless Hono route handler using fresh per-request transport+server instances

**Built MCP HTTP server module: per-job bearer-token registry and stateless Hono route handler using fresh per-request transport+server instances**

## What Happened

Created src/execution/mcp/http-server.ts with two exports: createMcpJobRegistry() (Map-backed per-job token registry with TTL/lazy-expiry) and createMcpHttpRoutes() (Hono app at /internal/mcp/:serverName). The route handler validates Bearer tokens, looks up a factory by server name, then creates fresh WebStandardStreamableHTTPServerTransport and McpSdkServerConfigWithInstance instances on every request — required by the stateless transport invariant (_hasHandledRequest flag). Added enableJsonResponse:true to produce predictable JSON responses. Created http-server.test.ts with 10 tests covering registry lifecycle and all 5 HTTP scenarios (no auth, wrong token, unknown server, valid MCP initialize, token unregister). Discovered that MCP POST requests require Accept: application/json, text/event-stream per spec — added to test helper.

## Verification

bun test ./src/execution/mcp/http-server.test.ts: 10 pass, 0 fail. bun run tsc --noEmit: exits 0 (clean).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/mcp/http-server.test.ts` | 0 | ✅ pass | 147ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 7400ms |


## Deviations

Added enableJsonResponse:true to transport constructor (not in plan sketch) to produce JSON rather than SSE responses — cleaner for test assertions and RPC usage. Added Accept: application/json, text/event-stream to test helper after hitting 406 from MCP spec guard.

## Known Issues

None.

## Files Created/Modified

- `src/execution/mcp/http-server.ts`
- `src/execution/mcp/http-server.test.ts`
- `.gsd/KNOWLEDGE.md`


## Deviations
Added enableJsonResponse:true to transport constructor (not in plan sketch) to produce JSON rather than SSE responses — cleaner for test assertions and RPC usage. Added Accept: application/json, text/event-stream to test helper after hitting 406 from MCP spec guard.

## Known Issues
None.
