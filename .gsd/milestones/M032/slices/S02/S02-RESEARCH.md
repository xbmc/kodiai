# S02 Research: MCP HTTP Server in Orchestrator

**Authored:** 2026-03-29
**Status:** Complete — ready for slice planning

---

## Summary

S02 is moderately complex: the technology (MCP SDK, Hono) is already in the codebase, but the per-request server instantiation pattern is non-obvious and the per-job registry needs careful wiring. The key constraint discovered during research: **stateless MCP transports cannot be reused across requests** — the SDK enforces this explicitly. This drives a per-request factory pattern.

---

## Recommendation

Build `src/execution/mcp/http-server.ts` as a new module that:
1. Manages a per-job `Map<token, McpServerFactories>` registry
2. Exposes a `createMcpHttpRoutes(registry)` function returning a Hono app mounted at `/internal/mcp`
3. For each request: creates a fresh `WebStandardStreamableHTTPServerTransport` + fresh server instance from the stored factory, connects them, handles the request
4. Validates the `Authorization: Bearer <token>` header against the registry before dispatching

Add `MCP_BASE_URL` to `BuildAcaJobSpecOpts` in `src/jobs/aca-launcher.ts` and a `createMcpJobSession()` / `destroyMcpJobSession()` lifecycle API.

---

## Critical Constraint: Stateless Transport Is Single-Use

The `WebStandardStreamableHTTPServerTransport` in stateless mode (no `sessionIdGenerator`) **cannot be reused**. From the SDK source:

```
// In stateless mode (no sessionIdGenerator), each request must use a fresh transport.
// Reusing a stateless transport causes message ID collisions between clients.
if (!this.sessionIdGenerator && this._hasHandledRequest) {
    throw new Error('Stateless transport cannot be reused across requests. Create a new transport per request.');
}
```

This means the HTTP handler must create a new transport **and** a new `McpServer` instance per request (because `McpServer.connect()` registers request handlers on the underlying Server, which cannot be set after the transport connects — `assertCanSetRequestHandler` throws "Cannot register capabilities after connecting to transport").

**Pattern for each HTTP request:**
1. Validate `Authorization: Bearer <token>` against the per-job registry
2. Get the factory closure for the named server (e.g., `github_comment`)
3. Call the factory to get a fresh `McpSdkServerConfigWithInstance`
4. Create a fresh `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })`
5. Call `serverConfig.instance.connect(transport)`
6. Return `transport.handleRequest(c.req.raw)`

The factory closures capture the per-job callbacks (`onPublish`, `getOctokit`, etc.) at job-dispatch time. They are stored in the registry and called fresh per HTTP request.

---

## Implementation Landscape

### New file: `src/execution/mcp/http-server.ts`

**Exports:**
- `createMcpJobRegistry()` — returns `{ register, unregister, getFactory, hasToken }`
- `createMcpHttpRoutes(registry)` — returns a Hono app with 7 routes under `/internal/mcp/:serverName`

**Registry shape:**
```ts
type McpJobEntry = {
  factories: Record<string, () => McpSdkServerConfigWithInstance>;
  expiresAt: number; // timeoutSeconds + buffer TTL for cleanup
};
const registry = new Map<string, McpJobEntry>(); // keyed by bearer token
```

**Token generation (in executor dispatch):**
```ts
import { randomBytes } from "node:crypto";
const mcpBearerToken = randomBytes(32).toString("hex");
```

**Hono route handler pattern (per server name):**
```ts
app.all("/internal/mcp/:serverName", async (c) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token || !registry.hasToken(token)) return c.json({ error: "Unauthorized" }, 401);
  
  const serverName = c.req.param("serverName");
  const factory = registry.getFactory(token, serverName);
  if (!factory) return c.json({ error: "Not found" }, 404);
  
  const serverConfig = factory();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await serverConfig.instance.connect(transport);
  return transport.handleRequest(c.req.raw);
});
```

### Existing file: `src/jobs/aca-launcher.ts` — additive change

`BuildAcaJobSpecOpts` needs `mcpBaseUrl: string` added (not optional — every job needs it). `buildAcaJobSpec` adds `{ name: "MCP_BASE_URL", value: opts.mcpBaseUrl }` to the env array. `MCP_BASE_URL` is not an application secret, so the runtime guard doesn't fire.

**This is a breaking change to `BuildAcaJobSpecOpts`** — the S01 tests pass `mcpBearerToken` but not `mcpBaseUrl`. The `S01` tests will need updating to add `mcpBaseUrl: "http://ca-kodiai.internal.env.eastus.azurecontainerapps.io"` to the test fixtures. This is a minor mechanical change.

### Existing file: `src/index.ts` — route registration

Mount the MCP HTTP routes on the main Hono app:
```ts
app.route("/internal", createMcpHttpRoutes(mcpJobRegistry));
```

The registry is created at startup and injected into `createExecutor` (or held at the index.ts level and passed to the executor factory). Registering/unregistering sessions is called from the executor's dispatch path (S03).

### Existing file: `src/config.ts` — new config fields

S02 needs two new optional config values:
- `mcpInternalBaseUrl` — the internal ACA FQDN for MCP callbacks (e.g., `https://ca-kodiai.internal.env.eastus.azurecontainerapps.io`). Default: `""` (empty → MCP HTTP server runs but no URL injected into job specs).
- `acaJobImage` — the agent container image tag. Default: `""`.

These can be optional in config since S02 only builds the server; S03 wires it to actual job dispatch.

---

## What the 7 Servers Need

All 7 servers call `createSdkMcpServer(...)` and return `McpSdkServerConfigWithInstance`. They all take closure arguments that capture per-job state:

| Server | Key closure deps |
|--------|-----------------|
| `github_comment` | `getOctokit`, `owner`, `repo`, `botHandles`, `onPublish`, `onPublishEvent`, `reviewOutputKey` |
| `github_inline_comment` | `getOctokit`, `owner`, `repo`, `prNumber`, `botHandles`, `reviewOutputKey`, `deliveryId`, `logger`, `onPublish` |
| `github_ci` | `getOctokit`, `owner`, `repo`, `prNumber` |
| `reviewCommentThread` | `getOctokit`, `owner`, `repo`, `botHandles`, `onPublish` |
| `review_checkpoint` | `knowledgeStore`, `reviewOutputKey`, `repo`, `prNumber`, `totalFiles`, `logger` |
| `github_issue_label` | `getOctokit`, `owner`, `repo`, `triageConfig` |
| `github_issue_comment` | `getOctokit`, `owner`, `repo`, `triageConfig`, `botHandles` |

The **factory per server** is just the existing create*Server() call wrapped in `() => create*Server(...)`. The factory returns a fresh `McpSdkServerConfigWithInstance` each time it's called.

The registry stores `factories: Record<string, () => McpSdkServerConfigWithInstance>` — a map from server name to factory function. Not all 7 servers are registered for every job (some are conditional on `prNumber`, `enableInlineTools`, etc.) — this matches the existing `buildMcpServers()` conditional logic.

---

## Verification Path (matches the roadmap demo)

The roadmap demo for S02:
```
curl -H 'Authorization: Bearer <valid-token>' http://localhost:PORT/internal/mcp/github_comment → MCP JSON response
same curl without token → 401
wrong token → 401
All 7 server routes respond.
```

**How to test this in unit tests:**
- Start a Hono test server with `createMcpHttpRoutes(registry)` mounted
- Register a mock factory that returns a minimal `createSdkMcpServer` instance
- Send POST requests (MCP initialize + tool call) to `/internal/mcp/github_comment`
- Assert 401 with no/wrong token, 200 with valid token
- Verify the response is valid MCP JSON

**The MCP initialize request** is the first message any client sends. It can be sent as a raw POST with JSON body `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}`. A 200 response with `result.capabilities` confirms the route is working.

**Tests file: `src/execution/mcp/http-server.test.ts`**

---

## Auth Middleware Design

Simple inline check (not Hono middleware — the route handler must distinguish "invalid token" from "server not found for valid token"):

```ts
// 401 if no/wrong token
const token = c.req.header("Authorization")?.replace(/^Bearer /, "");
if (!token || !registry.hasToken(token)) return c.json({ error: "Unauthorized" }, 401);

// 404 if valid token but server name not registered for this job
const serverName = c.req.param("serverName");
const factory = registry.getFactory(token, serverName);
if (!factory) return c.json({ error: "Not found" }, 404);
```

This makes the demo verification (`no token → 401`, `wrong token → 401`, `valid token → MCP response`) straightforward to unit test.

---

## Task Decomposition (for planner)

**T01: `src/execution/mcp/http-server.ts` — registry + Hono routes + tests**
- Create `createMcpJobRegistry()` with register/unregister/getFactory/hasToken
- Create `createMcpHttpRoutes(registry)` Hono app with `app.all("/internal/mcp/:serverName", ...)`
- Per-request: fresh transport + connect + handleRequest
- Tests: 401 paths, 404 server-not-found, 200 with valid MCP initialize request
- Files: `src/execution/mcp/http-server.ts`, `src/execution/mcp/http-server.test.ts`
- Verify: `bun test ./src/execution/mcp/http-server.test.ts`, `bun run tsc --noEmit`

**T02: `src/jobs/aca-launcher.ts` — add `mcpBaseUrl` to spec + `src/index.ts` route registration**
- Add `mcpBaseUrl: string` to `BuildAcaJobSpecOpts` and inject into env array
- Update `src/jobs/aca-launcher.test.ts` fixtures to include `mcpBaseUrl`
- Add `app.route("/internal", createMcpHttpRoutes(mcpJobRegistry))` to `src/index.ts`
- Create `mcpJobRegistry` at startup in index.ts
- Add `MCP_INTERNAL_BASE_URL` / `ACA_JOB_IMAGE` optional fields to `src/config.ts`
- Files: `src/jobs/aca-launcher.ts`, `src/jobs/aca-launcher.test.ts`, `src/index.ts`, `src/config.ts`
- Verify: `bun test ./src/jobs/aca-launcher.test.ts`, `bun run tsc --noEmit`

---

## Risks

- **Per-request factory cost** — Each HTTP request creates a fresh `McpServer` with all its tool handler registration. The 7 servers are small; this should be ~1ms overhead per call, acceptable.
- **McpServer capability registration window** — `registerCapabilities()` must be called before `connect()`. `createSdkMcpServer` does this internally during construction. Since we call the factory (which calls `createSdkMcpServer`) before `connect()`, this is safe.
- **Hono `app.all()` vs `app.post()`** — MCP Streamable HTTP uses POST for tool calls and optionally GET for SSE streams. Use `app.all()` to let the transport decide.
- **`c.req.raw`** — Hono's `c.req.raw` is the native `Request` object, which is what `WebStandardStreamableHTTPServerTransport.handleRequest()` expects. This is the Bun-native path — no adapter needed.
- **`src/config.ts` stub updates** — Any test stubs that construct `AppConfig` directly (there are many from the TypeScript error fixes in M030/S01) will need `mcpInternalBaseUrl` and `acaJobImage` added. These are optional-with-default in Zod, so test stubs don't need to set them explicitly if the schema uses `.default("")`.

---

## Sources

- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js` — stateless transport single-use enforcement (line 139)
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` — `connect()` and `registerCapabilities()` order requirement
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `McpSdkServerConfigWithInstance`, `McpHttpServerConfig` types
- `src/execution/mcp/index.ts` — conditional server registration logic
- `src/execution/mcp/comment-server.ts` — `createSdkMcpServer` pattern and closure shape
- `src/jobs/aca-launcher.ts` — `BuildAcaJobSpecOpts`, `APPLICATION_SECRET_NAMES`, env array structure
- `src/index.ts` — Hono app structure, `app.route()` pattern, `export default { port, fetch }`
- `src/routes/health.ts` — Hono route module pattern (`createHealthRoutes()` → `Hono`)
