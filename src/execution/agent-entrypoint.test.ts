import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { main, MCP_SERVER_NAMES } from "./agent-entrypoint.ts";
import type { EntrypointDeps } from "./agent-entrypoint.ts";
import type { Query, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid agent config JSON */
const VALID_AGENT_CONFIG = JSON.stringify({
  prompt: "Review this PR",
  model: "claude-sonnet-4-5-20250929",
  maxTurns: 20,
  allowedTools: ["Read", "Grep"],
});

/** Build a mock async iterable that yields the given messages */
function makeAsyncIterable(messages: object[]): Query {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => {
          if (i < messages.length) {
            return { value: messages[i++] as never, done: false };
          }
          return { value: undefined as never, done: true };
        },
        return: async () => ({ value: undefined as never, done: true }),
        throw: async (err: unknown) => { throw err; },
      };
    },
  } as unknown as Query;
}

/** Build a minimal SDKResultSuccess message */
function makeResultSuccess(): SDKResultMessage {
  return {
    type: "result",
    subtype: "success",
    result: "Looks good!",
    session_id: "sess-abc123",
    duration_ms: 1500,
    duration_api_ms: 1200,
    is_error: false,
    num_turns: 3,
    stop_reason: "end_turn",
    total_cost_usd: 0.05,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5,
      server_tool_use: null,
    } as never,
    modelUsage: {
      "claude-sonnet-4-5-20250929": {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 5,
        webSearchRequests: 0,
        costUSD: 0.05,
        contextWindow: 200_000,
        maxOutputTokens: 8192,
      },
    },
    permission_denials: [],
    uuid: "uuid-1" as never,
  };
}

// ---------------------------------------------------------------------------
// Saved env & restore helpers
// ---------------------------------------------------------------------------

let savedEnv: Record<string, string | undefined> = {};

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    savedEnv[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  savedEnv = {};
}

// ---------------------------------------------------------------------------
// Test setup: always clear the four required env vars before each test
// ---------------------------------------------------------------------------

const REQUIRED_ENV_KEYS = [
  "WORKSPACE_DIR",
  "MCP_BASE_URL",
  "MCP_BEARER_TOKEN",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
] as const;

beforeEach(() => {
  savedEnv = {};
  for (const k of REQUIRED_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  restoreEnv();
});

// ---------------------------------------------------------------------------
// Missing env vars
// ---------------------------------------------------------------------------

describe("missing env vars", () => {
  test("exits 1 when WORKSPACE_DIR is missing", async () => {
    setEnv({
      MCP_BASE_URL: "https://api.example.com",
      MCP_BEARER_TOKEN: "tok",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });

    let exitCode: number | undefined;
    const deps: Partial<EntrypointDeps> = {
      exitFn: (code) => { exitCode = code; return undefined as never; },
    };
    await main(deps);
    expect(exitCode).toBe(1);
  });

  test("exits 1 when MCP_BASE_URL is missing", async () => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BEARER_TOKEN: "tok",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });

    let exitCode: number | undefined;
    const deps: Partial<EntrypointDeps> = {
      exitFn: (code) => { exitCode = code; return undefined as never; },
    };
    await main(deps);
    expect(exitCode).toBe(1);
  });

  test("exits 1 when MCP_BEARER_TOKEN is missing", async () => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BASE_URL: "https://api.example.com",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });

    let exitCode: number | undefined;
    const deps: Partial<EntrypointDeps> = {
      exitFn: (code) => { exitCode = code; return undefined as never; },
    };
    await main(deps);
    expect(exitCode).toBe(1);
  });

  test("exits 1 when both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are missing", async () => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BASE_URL: "https://api.example.com",
      MCP_BEARER_TOKEN: "tok",
    });

    let exitCode: number | undefined;
    const deps: Partial<EntrypointDeps> = {
      exitFn: (code) => { exitCode = code; return undefined as never; },
    };
    await main(deps);
    expect(exitCode).toBe(1);
  });

  test("does not exit 1 when CLAUDE_CODE_OAUTH_TOKEN is provided instead of ANTHROPIC_API_KEY", async () => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BASE_URL: "https://api.example.com",
      MCP_BEARER_TOKEN: "tok",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-tok",
    });

    const written: Record<string, string> = {};
    let exitCode: number | undefined;

    const deps: Partial<EntrypointDeps> = {
      exitFn: (code) => { exitCode = code; return undefined as never; },
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => { written[path] = content; },
      queryFn: () => makeAsyncIterable([makeResultSuccess()]),
    };
    await main(deps);
    expect(exitCode).toBeUndefined();
    expect(written["/tmp/ws/result.json"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Missing / invalid agent-config.json
// ---------------------------------------------------------------------------

describe("agent-config.json errors", () => {
  test("exits 1 when agent-config.json file is missing", async () => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BASE_URL: "https://api.example.com",
      MCP_BEARER_TOKEN: "tok",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });

    let exitCode: number | undefined;
    const deps: Partial<EntrypointDeps> = {
      exitFn: (code) => { exitCode = code; return undefined as never; },
      readFileFn: async () => { throw new Error("ENOENT: no such file or directory"); },
    };
    await main(deps);
    expect(exitCode).toBe(1);
  });

  test("exits 1 when agent-config.json contains invalid JSON", async () => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BASE_URL: "https://api.example.com",
      MCP_BEARER_TOKEN: "tok",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });

    let exitCode: number | undefined;
    const deps: Partial<EntrypointDeps> = {
      exitFn: (code) => { exitCode = code; return undefined as never; },
      readFileFn: async () => "{ invalid json !!!",
    };
    await main(deps);
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("happy path", () => {
  beforeEach(() => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BASE_URL: "https://api.example.com",
      MCP_BEARER_TOKEN: "bearer-tok",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
  });

  test("writes result.json with conclusion 'success' after successful SDK run", async () => {
    const written: Record<string, string> = {};

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => { written[path] = content; },
      queryFn: () => makeAsyncIterable([makeResultSuccess()]),
    };

    await main(deps);

    const resultJson = written["/tmp/ws/result.json"];
    expect(resultJson).toBeDefined();
    const result = JSON.parse(resultJson!) as Record<string, unknown>;
    expect(result.conclusion).toBe("success");
    expect(result.numTurns).toBe(3);
    expect(result.costUsd).toBe(0.05);
    expect(result.sessionId).toBe("sess-abc123");
    expect(result.model).toBe("claude-sonnet-4-5-20250929");
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.cacheReadTokens).toBe(10);
    expect(result.cacheCreationTokens).toBe(5);
    expect(result.resultText).toBe("Looks good!");
    expect(result.stopReason).toBe("end_turn");
  });

  test("writes CLAUDE.md before invoking SDK", async () => {
    const written: Record<string, string> = {};
    const writeOrder: string[] = [];

    let queryCalled = false;

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => {
        written[path] = content;
        writeOrder.push(path);
      },
      queryFn: () => {
        queryCalled = true;
        return makeAsyncIterable([makeResultSuccess()]);
      },
    };

    await main(deps);

    expect(queryCalled).toBe(true);
    expect(writeOrder.indexOf("/tmp/ws/CLAUDE.md")).toBeLessThan(
      writeOrder.indexOf("/tmp/ws/result.json"),
    );
    expect(written["/tmp/ws/CLAUDE.md"]).toContain("Security Policy");
  });

  test("passes all 7 MCP server names to queryFn", async () => {
    let capturedOptions: Record<string, unknown> | undefined;

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async () => undefined,
      queryFn: (params) => {
        capturedOptions = params.options as Record<string, unknown>;
        return makeAsyncIterable([makeResultSuccess()]);
      },
    };

    await main(deps);

    expect(capturedOptions).toBeDefined();
    const mcpServers = capturedOptions!.mcpServers as Record<string, { type: string; url: string; headers: Record<string, string> }>;
    expect(Object.keys(mcpServers).sort()).toEqual([...MCP_SERVER_NAMES].sort());
    for (const name of MCP_SERVER_NAMES) {
      const srv = mcpServers[name]!;
      expect(srv.type).toBe("http");
      expect(srv.url).toBe(`https://api.example.com/internal/mcp/${name}`);
      expect(srv.headers["Authorization"]).toBe("Bearer bearer-tok");
    }
  });

  test("passes prompt, model, maxTurns, allowedTools from agent-config.json", async () => {
    let capturedParams: { prompt: string; options?: Record<string, unknown> } | undefined;

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async () => undefined,
      queryFn: (params) => {
        capturedParams = params as { prompt: string; options?: Record<string, unknown> };
        return makeAsyncIterable([makeResultSuccess()]);
      },
    };

    await main(deps);

    expect(capturedParams!.prompt).toBe("Review this PR");
    const opts = capturedParams!.options!;
    expect(opts.model).toBe("claude-sonnet-4-5-20250929");
    expect(opts.maxTurns).toBe(20);
    expect(opts.allowedTools).toEqual(["Read", "Grep"]);
    expect(opts.permissionMode).toBe("bypassPermissions");
    expect(opts.allowDangerouslySkipPermissions).toBe(true);
    expect(opts.settingSources).toEqual(["project"]);
    expect(opts.cwd).toBe("/tmp/ws");
  });
});

// ---------------------------------------------------------------------------
// SDK iterator throws → result.json with conclusion: 'error'
// ---------------------------------------------------------------------------

describe("SDK error handling", () => {
  beforeEach(() => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BASE_URL: "https://api.example.com",
      MCP_BEARER_TOKEN: "bearer-tok",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
  });

  test("writes result.json with conclusion 'error' when SDK iterator throws", async () => {
    const written: Record<string, string> = {};

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => { written[path] = content; },
      queryFn: () => {
        const iter: AsyncGenerator<never, void> = (async function* () {
          throw new Error("SDK connection refused");
        })();
        return iter as unknown as Query;
      },
    };

    await main(deps);

    const resultJson = written["/tmp/ws/result.json"];
    expect(resultJson).toBeDefined();
    const result = JSON.parse(resultJson!) as Record<string, unknown>;
    expect(result.conclusion).toBe("error");
    expect(result.errorMessage).toContain("SDK connection refused");
  });

  test("writes result.json with conclusion 'error' when no result message received", async () => {
    const written: Record<string, string> = {};

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => { written[path] = content; },
      queryFn: () => makeAsyncIterable([]), // iterator yields no messages
    };

    await main(deps);

    const resultJson = written["/tmp/ws/result.json"];
    expect(resultJson).toBeDefined();
    const result = JSON.parse(resultJson!) as Record<string, unknown>;
    expect(result.conclusion).toBe("error");
    expect(result.errorMessage).toContain("No result message");
  });
});
