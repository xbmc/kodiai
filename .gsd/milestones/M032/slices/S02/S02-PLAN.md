# S02: MCP HTTP Server in Orchestrator

**Goal:** Build an authenticated MCP HTTP server in the orchestrator that lets the isolated ACA agent job call MCP tools over HTTP. The server uses per-request fresh transports (stateless mode), validates a per-job bearer token, and exposes a registry API for registering/unregistering job sessions.
**Demo:** After this: After S02: curl -H 'Authorization: Bearer <valid-token>' http://localhost:PORT/internal/mcp/github_comment → MCP JSON response; same curl without token → 401; wrong token → 401. All 7 server routes respond.

## Tasks
- [x] **T01: Built MCP HTTP server module: per-job bearer-token registry and stateless Hono route handler using fresh per-request transport+server instances** — Build the MCP HTTP server module: a per-job registry keyed by bearer token and a Hono app that handles stateless MCP requests per-request.

The critical constraint: `WebStandardStreamableHTTPServerTransport` in stateless mode (no `sessionIdGenerator`) cannot be reused across requests — the SDK throws if `_hasHandledRequest` is already set. So every HTTP request must create a fresh transport AND a fresh server instance (because `McpServer.connect()` registers tool handlers on the Server object which can't be re-registered after connecting).

**Steps:**

1. Create `src/execution/mcp/http-server.ts`:

```ts
import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
```

2. Define `McpJobEntry` type and `createMcpJobRegistry()` factory:
```ts
type McpJobEntry = {
  factories: Record<string, () => McpSdkServerConfigWithInstance>;
  expiresAt: number;
};

export function createMcpJobRegistry() {
  const registry = new Map<string, McpJobEntry>();
  return {
    register(token: string, factories: Record<string, () => McpSdkServerConfigWithInstance>, ttlMs = 3_600_000): void { ... },
    unregister(token: string): void { ... },
    hasToken(token: string): boolean { return registry.has(token); },
    getFactory(token: string, serverName: string): (() => McpSdkServerConfigWithInstance) | undefined { ... },
  };
}

export type McpJobRegistry = ReturnType<typeof createMcpJobRegistry>;
```

3. Create `createMcpHttpRoutes(registry, logger?)` returning a Hono app:
```ts
export function createMcpHttpRoutes(registry: McpJobRegistry, logger?: Logger): Hono {
  const app = new Hono();
  app.all("/internal/mcp/:serverName", async (c) => {
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.replace(/^Bearer /, "");
    if (!token || !registry.hasToken(token)) {
      logger?.warn({ tokenPrefix: token?.slice(0, 8) }, "MCP HTTP: unauthorized");
      return c.json({ error: "Unauthorized" }, 401);
    }
    const serverName = c.req.param("serverName");
    const factory = registry.getFactory(token, serverName);
    if (!factory) {
      logger?.warn({ serverName, tokenPrefix: token.slice(0, 8) }, "MCP HTTP: server not found");
      return c.json({ error: "Not Found" }, 404);
    }
    const serverConfig = factory(); // fresh McpSdkServerConfigWithInstance
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await serverConfig.instance.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  return app;
}
```

4. Create `src/execution/mcp/http-server.test.ts`:
   - Import `createMcpJobRegistry`, `createMcpHttpRoutes` from `./http-server.ts`
   - Import `createSdkMcpServer` from `@anthropic-ai/claude-agent-sdk` and `tool` to build a minimal test server factory
   - Build a minimal test factory: `() => createSdkMcpServer({ name: "test_server", version: "0.1.0", tools: [] })`
   - Use Hono's test helper or `new Request(url, opts)` + `app.fetch(req)` to send requests
   - Tests:
     a. `no Authorization header → 401`
     b. `wrong token → 401`
     c. `valid token + unknown server name → 404`
     d. `valid token + registered server + MCP initialize request → 200 with valid MCP JSON response`
     e. `unregister removes token → subsequent request → 401`

   For test (d), the MCP initialize request body is:
   ```json
   {"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}
   ```
   Send as POST with `Content-Type: application/json`. Expect 200 and response body containing `"result"` and `"capabilities"`.

5. Run `bun test ./src/execution/mcp/http-server.test.ts` and fix until all pass.
6. Run `bun run tsc --noEmit` and fix any type errors introduced.
  - Estimate: 2h
  - Files: src/execution/mcp/http-server.ts, src/execution/mcp/http-server.test.ts
  - Verify: bun test ./src/execution/mcp/http-server.test.ts && bun run tsc --noEmit
- [x] **T02: Wired MCP_BASE_URL into ACA job specs, added mcpInternalBaseUrl/acaJobImage config fields, and mounted MCP HTTP routes in index.ts** — Integrate the MCP HTTP server into the orchestrator startup and the ACA job spec builder.

**Steps:**

1. **`src/jobs/aca-launcher.ts`** — add `mcpBaseUrl: string` to `BuildAcaJobSpecOpts` and inject it into the job env array as `{ name: "MCP_BASE_URL", value: opts.mcpBaseUrl }`. Place it between the existing required env entries. Note: `MCP_BASE_URL` is NOT in `APPLICATION_SECRET_NAMES`, so the runtime guard will not fire.

2. **`src/jobs/aca-launcher.test.ts`** — update the `BASE_OPTS` fixture (and any other test fixtures that construct `BuildAcaJobSpecOpts`) to include `mcpBaseUrl: "http://ca-kodiai.internal.env.eastus.azurecontainerapps.io"`. Add a test: `MCP_BASE_URL env var present in spec` asserting `spec.env.find(e => e.name === 'MCP_BASE_URL')?.value === opts.mcpBaseUrl`. Also verify `MCP_BASE_URL` is not in `APPLICATION_SECRET_NAMES` (it shouldn't be — confirm the guard doesn't fire).

3. **`src/config.ts`** — add two optional fields to `configSchema`:
```ts
mcpInternalBaseUrl: z.string().default(""),
acaJobImage: z.string().default(""),
```
And in `loadConfig`'s parse input:
```ts
mcpInternalBaseUrl: process.env.MCP_INTERNAL_BASE_URL,
acaJobImage: process.env.ACA_JOB_IMAGE,
```
Using `.default("")` means existing test stubs that construct `AppConfig` directly don't need updating (Zod fills the default).

4. **`src/index.ts`** — add:
```ts
import { createMcpJobRegistry } from "./execution/mcp/http-server.ts";
import { createMcpHttpRoutes } from "./execution/mcp/http-server.ts";
```
Near the start of the app section, create the registry:
```ts
const mcpJobRegistry = createMcpJobRegistry();
```
Mount the routes on the Hono app (before the catch-all error handler):
```ts
app.route("/internal", createMcpHttpRoutes(mcpJobRegistry, logger));
```
The registry is module-level so S03 can import it or receive it via dependency injection.

5. Export `mcpJobRegistry` from `src/index.ts` is NOT necessary — S03 will wire it via the executor factory. Just create it as a local variable passed to `createMcpHttpRoutes`.

6. Run `bun test ./src/jobs/aca-launcher.test.ts` and fix until all pass.
7. Run `bun run tsc --noEmit` — fix any errors (particularly AppConfig stubs in test files that may need the new optional fields, though `.default("")` in Zod should make them optional in parsed output).
  - Estimate: 1h
  - Files: src/jobs/aca-launcher.ts, src/jobs/aca-launcher.test.ts, src/config.ts, src/index.ts
  - Verify: bun test ./src/jobs/aca-launcher.test.ts && bun run tsc --noEmit
