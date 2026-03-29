---
estimated_steps: 70
estimated_files: 2
skills_used: []
---

# T01: Create src/execution/mcp/http-server.ts — registry, Hono routes, and tests

Build the MCP HTTP server module: a per-job registry keyed by bearer token and a Hono app that handles stateless MCP requests per-request.

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

## Inputs

- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/index.ts`
- `src/routes/health.ts`

## Expected Output

- `src/execution/mcp/http-server.ts`
- `src/execution/mcp/http-server.test.ts`

## Verification

bun test ./src/execution/mcp/http-server.test.ts && bun run tsc --noEmit

## Observability Impact

Route handler logs 401/404 at warn level with tokenPrefix (first 8 chars) and serverName. Registry register/unregister log at info level with tokenPrefix and factory count for future debugging.
