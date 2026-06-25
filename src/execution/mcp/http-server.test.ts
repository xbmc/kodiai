import { describe, test, expect } from "bun:test";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import {
  createMcpJobRegistry,
  createMcpHttpRoutes,
} from "./http-server.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFactory() {
  return () =>
    createSdkMcpServer({ name: "test_server", version: "0.1.0", tools: [] });
}

const MCP_INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "0.1" },
  },
});

function mcpPost(
  app: ReturnType<typeof createMcpHttpRoutes>,
  serverName: string,
  token?: string,
  authHeaderName = "Authorization",
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // MCP spec requires both content types in Accept for POST requests.
    "Accept": "application/json, text/event-stream",
  };
  if (token) headers[authHeaderName] = `Bearer ${token}`;
  const req = new Request(`http://localhost/internal/mcp/${serverName}`, {
    method: "POST",
    headers,
    body: MCP_INIT_BODY,
  });
  return app.fetch(req);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createMcpJobRegistry", () => {
  test("hasToken returns false for unknown token", () => {
    const reg = createMcpJobRegistry();
    expect(reg.hasToken("unknown")).toBe(false);
  });

  test("register then hasToken returns true", () => {
    const reg = createMcpJobRegistry();
    reg.register("tok-1", { test_server: makeFactory() });
    expect(reg.hasToken("tok-1")).toBe(true);
  });

  test("unregister removes token", () => {
    const reg = createMcpJobRegistry();
    reg.register("tok-2", { test_server: makeFactory() });
    reg.unregister("tok-2");
    expect(reg.hasToken("tok-2")).toBe(false);
  });

  test("unregistering an unknown token does not mark it retired", () => {
    const reg = createMcpJobRegistry();
    reg.unregister("never-registered");

    expect(reg.inspectToken("never-registered")).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  test("getFactory returns undefined for unknown server", () => {
    const reg = createMcpJobRegistry();
    reg.register("tok-3", { test_server: makeFactory() });
    expect(reg.getFactory("tok-3", "nonexistent")).toBeUndefined();
  });

  test("expired token is treated as absent", () => {
    const reg = createMcpJobRegistry();
    reg.register("tok-exp", { test_server: makeFactory() }, -1); // already expired
    expect(reg.hasToken("tok-exp")).toBe(false);
  });

  test("inspectToken distinguishes missing from expired tokens", () => {
    const reg = createMcpJobRegistry();
    reg.register("tok-exp", { test_server: makeFactory() }, -1);

    expect(reg.inspectToken("missing-token")).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(reg.inspectToken("tok-exp")).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });

  test("registry evicts oldest active tokens under high churn", () => {
    const reg = createMcpJobRegistry();
    for (let i = 0; i < 5_010; i++) {
      reg.register(`tok-${i}`, { test_server: makeFactory() });
    }

    expect(reg.inspectToken("tok-0")).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(reg.hasToken("tok-10")).toBe(true);
    expect(reg.hasToken("tok-5009")).toBe(true);
  });
});

describe("createMcpHttpRoutes", () => {
  test("no Authorization header → 401", async () => {
    const registry = createMcpJobRegistry();
    const app = createMcpHttpRoutes(registry);

    const req = new Request("http://localhost/internal/mcp/test_server", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: MCP_INIT_BODY,
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  test("wrong token → 401", async () => {
    const registry = createMcpJobRegistry();
    registry.register("valid-token", { test_server: makeFactory() });
    const app = createMcpHttpRoutes(registry);

    const res = await mcpPost(app, "test_server", "wrong-token");
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  test("unauthorized requests log absent, missing, and expected expired token reasons below warning level", async () => {
    const registry = createMcpJobRegistry();
    registry.register("expired-token", { test_server: makeFactory() }, -1);
    const warnings: Array<Record<string, unknown>> = [];
    const infos: Array<Record<string, unknown>> = [];
    const logger = {
      warn: (data: Record<string, unknown>) => warnings.push(data),
      info: (data: Record<string, unknown>) => infos.push(data),
    };
    const app = createMcpHttpRoutes(registry, logger as never);

    const absent = await mcpPost(app, "test_server");
    const missing = await mcpPost(app, "test_server", "missing-token");
    const expired = await mcpPost(app, "test_server", "expired-token");

    expect(absent.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(expired.status).toBe(401);
    expect(warnings).toHaveLength(0);
    expect(infos).toContainEqual(expect.objectContaining({
      authFailureReason: "missing",
      authFailureExpected: true,
    }));
    expect(infos).toContainEqual(expect.objectContaining({
      authFailureReason: "missing",
      authFailureExpected: true,
      tokenLogId: expect.any(String),
    }));
    expect(infos).toContainEqual(expect.objectContaining({
      authFailureReason: "expired",
      authFailureExpected: true,
      ttlRemainingMs: expect.any(Number),
    }));
  });

  test("valid token + unknown server name → 404", async () => {
    const registry = createMcpJobRegistry();
    registry.register("valid-token", { test_server: makeFactory() });
    const app = createMcpHttpRoutes(registry);

    const res = await mcpPost(app, "other_server", "valid-token");
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Not Found");
  });

  test("valid token + registered server + MCP initialize request → 200 with MCP JSON result", async () => {
    const registry = createMcpJobRegistry();
    registry.register("valid-token", { test_server: makeFactory() });
    const app = createMcpHttpRoutes(registry);

    const res = await mcpPost(app, "test_server", "valid-token");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("result");
    expect(text).toContain("capabilities");
  });

  test("accepts Kodiai MCP auth header when Authorization is unavailable", async () => {
    const registry = createMcpJobRegistry();
    registry.register("valid-token", { test_server: makeFactory() });
    const app = createMcpHttpRoutes(registry);

    const res = await mcpPost(
      app,
      "test_server",
      "valid-token",
      "X-Kodiai-MCP-Authorization",
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("result");
  });

  test("accepts MCP token query param when headers are unavailable", async () => {
    const registry = createMcpJobRegistry();
    registry.register("valid-token", { test_server: makeFactory() });
    const app = createMcpHttpRoutes(registry);

    const req = new Request(
      "http://localhost/internal/mcp/test_server?kodiai_mcp_token=valid-token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
        },
        body: MCP_INIT_BODY,
      },
    );
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("result");
  });

  test("query token keeps missing auth behavior when absent", async () => {
    const registry = createMcpJobRegistry();
    registry.register("valid-token", { test_server: makeFactory() });
    const app = createMcpHttpRoutes(registry);

    const req = new Request(
      "http://localhost/internal/mcp/test_server?kodiai_mcp_token=",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
        },
        body: MCP_INIT_BODY,
      },
    );
    const res = await app.fetch(req);

    expect(res.status).toBe(401);
  });

  test("rate-limits verified MCP requests by token and server", async () => {
    const registry = createMcpJobRegistry();
    registry.register("valid-token", { test_server: makeFactory() });
    const app = createMcpHttpRoutes(registry, undefined, {
      verified: { max: 1, windowMs: 60_000 },
    });

    const first = await mcpPost(app, "test_server", "valid-token");
    const second = await mcpPost(app, "test_server", "valid-token");

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    const body = await second.json() as { error: string };
    expect(body.error).toBe("Rate limited");
  });

  test("unregister removes token and logs late requests as expected retired-token auth misses", async () => {
    const registry = createMcpJobRegistry();
    registry.register("valid-token", { test_server: makeFactory() });
    const warnings: Array<Record<string, unknown>> = [];
    const infos: Array<Record<string, unknown>> = [];
    const logger = {
      warn: (data: Record<string, unknown>) => warnings.push(data),
      info: (data: Record<string, unknown>) => infos.push(data),
    };
    const app = createMcpHttpRoutes(registry, logger as never);

    // First request succeeds
    const res1 = await mcpPost(app, "test_server", "valid-token");
    expect(res1.status).toBe(200);

    // Unregister
    registry.unregister("valid-token");

    // Second request rejected but classified as expected lifecycle noise
    const res2 = await mcpPost(app, "test_server", "valid-token");
    expect(res2.status).toBe(401);
    expect(infos).toContainEqual(expect.objectContaining({
      authFailureReason: "retired",
      authFailureExpected: true,
      tokenLogId: expect.any(String),
    }));
    expect(infos.find((entry) => entry.authFailureReason === "retired")?.tokenLogId).not.toBe("valid-to");
    expect(warnings).not.toContainEqual(expect.objectContaining({ authFailureReason: "retired" }));
  });

  test("token sharing a retired token prefix is still treated as missing", async () => {
    const registry = createMcpJobRegistry();
    registry.register("valid-token", { test_server: makeFactory() });
    const warnings: Array<Record<string, unknown>> = [];
    const infos: Array<Record<string, unknown>> = [];
    const logger = {
      warn: (data: Record<string, unknown>) => warnings.push(data),
      info: (data: Record<string, unknown>) => infos.push(data),
    };
    const app = createMcpHttpRoutes(registry, logger as never);

    registry.unregister("valid-token");

    const res = await mcpPost(app, "test_server", "valid-token-but-different");
    expect(res.status).toBe(401);
    expect(infos).toContainEqual(expect.objectContaining({
      authFailureReason: "missing",
      authFailureExpected: true,
      tokenLogId: expect.any(String),
    }));
    expect(warnings).toHaveLength(0);
    expect(infos).not.toContainEqual(expect.objectContaining({ authFailureReason: "retired" }));
  });
});
