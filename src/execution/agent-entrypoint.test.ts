import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { main, MCP_SERVER_NAMES } from "./agent-entrypoint.ts";
import type { EntrypointDeps } from "./agent-entrypoint.ts";
import type { Query, SDKResultMessage, SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";

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

/** Build a minimal SDK assistant message with content blocks */
function makeAssistantMessage(content: object[]): object {
  return {
    type: "assistant",
    message: {
      content,
    },
  };
}

/** Build a minimal SDK system init message */
function makeSystemInitMessage(params: {
  tools: string[];
  mcpServers: Array<{ name: string; status: string }>;
}): object {
  return {
    type: "system",
    subtype: "init",
    tools: params.tools,
    mcp_servers: params.mcpServers,
    cwd: "/tmp/ws",
    model: "claude-sonnet-4-5-20250929",
    permissionMode: "bypassPermissions",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    apiKeySource: "oauth",
    claude_code_version: "test",
    session_id: "sess-init",
    uuid: "uuid-init",
  };
}

/** Build a minimal SDKRateLimitEvent message */
function makeRateLimitEvent(info: Partial<SDKRateLimitInfo> = {}): object {
  return {
    type: 'rate_limit_event',
    uuid: 'uuid-rl',
    session_id: 'sess-rl',
    rate_limit_info: { status: 'allowed', ...info },
  };
}

// ---------------------------------------------------------------------------
// Saved env & restore helpers
// ---------------------------------------------------------------------------

let savedEnv: Record<string, string | undefined> = {};
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

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

afterEach(async () => {
  restoreEnv();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
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
      appendFileFn: async () => undefined,
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
      appendFileFn: async () => undefined,
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
      appendFileFn: async () => undefined,
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
      appendFileFn: async () => undefined,
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

  test("passes all 7 MCP server names to queryFn", async () => {
    let capturedOptions: Record<string, unknown> | undefined;

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async () => undefined,
      appendFileFn: async () => undefined,
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

  test("does not double-append internal/mcp when MCP_BASE_URL already includes the route prefix", async () => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BASE_URL: "https://api.example.com/internal/mcp",
      MCP_BEARER_TOKEN: "bearer-tok",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });

    let capturedOptions: Record<string, unknown> | undefined;

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async () => undefined,
      appendFileFn: async () => undefined,
      queryFn: (params) => {
        capturedOptions = params.options as Record<string, unknown>;
        return makeAsyncIterable([makeResultSuccess()]);
      },
    };

    await main(deps);

    expect(capturedOptions).toBeDefined();
    const mcpServers = capturedOptions!.mcpServers as Record<string, { type: string; url: string }>;
    for (const name of MCP_SERVER_NAMES) {
      expect(mcpServers[name]?.url).toBe(`https://api.example.com/internal/mcp/${name}`);
    }
  });

  test("passes prompt, model, maxTurns, allowedTools from agent-config.json", async () => {
    let capturedParams: { prompt: string; options?: Record<string, unknown> } | undefined;

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async () => undefined,
      appendFileFn: async () => undefined,
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

  test("uses repoCwd from agent-config.json when provided", async () => {
    let capturedParams: { prompt: string; options?: Record<string, unknown> } | undefined;

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => JSON.stringify({
        prompt: "Review this PR",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 20,
        allowedTools: ["Read", "Grep"],
        repoCwd: "/tmp/ws/repo",
      }),
      writeFileFn: async () => undefined,
      appendFileFn: async () => undefined,
      queryFn: (params) => {
        capturedParams = params as { prompt: string; options?: Record<string, unknown> };
        return makeAsyncIterable([makeResultSuccess()]);
      },
    };

    await main(deps);

    expect(capturedParams).toBeDefined();
    expect(capturedParams!.options!.cwd).toBe("/tmp/ws/repo");
  });

  test("materializes repoBundlePath to a local git checkout before invoking SDK", async () => {
    const workspaceDir = await makeTempDir("agent-entrypoint-workspace-");
    const sourceRepoDir = await makeTempDir("agent-entrypoint-source-");
    const bundlePath = join(workspaceDir, "repo.bundle");

    await mkdir(join(sourceRepoDir, "system", "settings"), { recursive: true });
    await writeFile(join(sourceRepoDir, "system", "settings", "linux.xml"), "<settings />\n");
    await writeFile(join(sourceRepoDir, ".kodiai.yml"), "review:\n  enabled: true\n");

    await $`git -C ${sourceRepoDir} init`.quiet();
    await $`git -C ${sourceRepoDir} config user.email t@example.com`.quiet();
    await $`git -C ${sourceRepoDir} config user.name T`.quiet();
    await $`git -C ${sourceRepoDir} remote add origin https://github.com/xbmc/xbmc.git`.quiet();
    await symlink("linux.xml", join(sourceRepoDir, "system", "settings", "freebsd.xml"));
    await $`git -C ${sourceRepoDir} add .`.quiet();
    await $`git -C ${sourceRepoDir} commit -m init`.quiet();
    await $`git -C ${sourceRepoDir} branch -M main`.quiet();
    await $`git -C ${sourceRepoDir} checkout -b pr-mention`.quiet();
    await writeFile(join(sourceRepoDir, "feature.ts"), "export const enabled = true;\n");
    await $`git -C ${sourceRepoDir} add .`.quiet();
    await $`git -C ${sourceRepoDir} commit -m feature`.quiet();
    await $`git -C ${sourceRepoDir} bundle create ${bundlePath} --all`.quiet();

    const agentConfig = {
      prompt: "Review this PR",
      model: "claude-sonnet-4-5-20250929",
      maxTurns: 20,
      allowedTools: ["Read", "Grep"],
      repoBundlePath: bundlePath,
      repoOriginUrl: "https://github.com/xbmc/xbmc.git",
    };
    await writeFile(join(workspaceDir, "agent-config.json"), JSON.stringify(agentConfig));

    setEnv({
      WORKSPACE_DIR: workspaceDir,
      MCP_BASE_URL: "https://api.example.com",
      MCP_BEARER_TOKEN: "bearer-tok",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });

    let capturedParams: { prompt: string; options?: Record<string, unknown> } | undefined;
    const deps: Partial<EntrypointDeps> = {
      queryFn: (params) => {
        capturedParams = params as { prompt: string; options?: Record<string, unknown> };
        return makeAsyncIterable([makeResultSuccess()]);
      },
    };

    await main(deps);

    expect(capturedParams).toBeDefined();
    const cwd = capturedParams!.options!.cwd as string;
    expect(cwd).not.toBe(workspaceDir);
    expect(cwd).not.toBe(bundlePath);
    expect(await $`git -C ${cwd} branch --show-current`.quiet().text()).toContain("pr-mention");
    expect(await $`git -C ${cwd} remote get-url origin`.quiet().text()).toContain("https://github.com/xbmc/xbmc.git");
    expect((await $`git -C ${cwd} diff origin/main...HEAD --stat`.quiet()).text()).toContain("feature.ts");
  });
});

// ---------------------------------------------------------------------------
// tool_use capture
// ---------------------------------------------------------------------------

describe("tool_use capture", () => {
  beforeEach(() => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BASE_URL: "https://api.example.com",
      MCP_BEARER_TOKEN: "bearer-tok",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
  });

  test("captures repo inspection tool use from assistant stream", async () => {
    const written: Record<string, string> = {};

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => { written[path] = content; },
      appendFileFn: async () => undefined,
      queryFn: () =>
        makeAsyncIterable([
          makeAssistantMessage([
            { type: "tool_use", name: "Glob" },
            { type: "tool_use", name: "Read" },
          ]),
          makeResultSuccess(),
        ]),
    };

    await main(deps);

    const parsedResult = JSON.parse(written["/tmp/ws/result.json"]!) as Record<string, unknown>;
    expect(parsedResult.toolUseNames).toEqual(["Glob", "Read"]);
    expect(parsedResult.usedRepoInspectionTools).toBe(true);
  });

  test("does not mark GitHub publish-only tool use as repo inspection evidence", async () => {
    const written: Record<string, string> = {};

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => { written[path] = content; },
      appendFileFn: async () => undefined,
      queryFn: () =>
        makeAsyncIterable([
          makeAssistantMessage([
            { type: "tool_use", name: "mcp__github_comment__create_comment" },
          ]),
          makeResultSuccess(),
        ]),
    };

    await main(deps);

    const parsedResult = JSON.parse(written["/tmp/ws/result.json"]!) as Record<string, unknown>;
    expect(parsedResult.toolUseNames).toEqual(["mcp__github_comment__create_comment"]);
    expect(parsedResult.usedRepoInspectionTools).toBe(false);
  });
});

describe("SDK init diagnostics", () => {
  beforeEach(() => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BASE_URL: "https://api.example.com",
      MCP_BEARER_TOKEN: "bearer-tok",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
  });

  test("logs SDK init tool list and MCP server status to diagnostics", async () => {
    const written: Record<string, string> = {};
    const diagnosticLines: string[] = [];

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => { written[path] = content; },
      appendFileFn: async (_path, content) => { diagnosticLines.push(content); },
      queryFn: () =>
        makeAsyncIterable([
          makeSystemInitMessage({
            tools: ["Read", "mcp__github_comment__create_comment"],
            mcpServers: [
              { name: "github_comment", status: "connected" },
              { name: "github_inline_comment", status: "failed" },
            ],
          }),
          makeResultSuccess(),
        ]),
    };

    await main(deps);

    const diagnostics = diagnosticLines.join("");
    expect(diagnostics).toContain("sdk init tools=Read,mcp__github_comment__create_comment");
    expect(diagnostics).toContain("mcpServers=github_comment:connected,github_inline_comment:failed");
    expect(written["/tmp/ws/result.json"]).toBeDefined();
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
      appendFileFn: async () => undefined,
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
      appendFileFn: async () => undefined,
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

// ---------------------------------------------------------------------------
// rate_limit_event capture
// ---------------------------------------------------------------------------

describe("rate_limit_event capture", () => {
  beforeEach(() => {
    setEnv({
      WORKSPACE_DIR: "/tmp/ws",
      MCP_BASE_URL: "https://api.example.com",
      MCP_BEARER_TOKEN: "bearer-tok",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
  });

  test("single event captured — usageLimit populated from the event", async () => {
    const written: Record<string, string> = {};

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => { written[path] = content; },
      appendFileFn: async () => undefined,
      queryFn: () =>
        makeAsyncIterable([
          makeRateLimitEvent({ utilization: 0.75, rateLimitType: "seven_day", resetsAt: 9999 }),
          makeResultSuccess(),
        ]),
    };

    await main(deps);

    const parsedResult = JSON.parse(written["/tmp/ws/result.json"]!) as Record<string, unknown>;
    expect(parsedResult.usageLimit).toEqual({
      utilization: 0.75,
      rateLimitType: "seven_day",
      resetsAt: 9999,
    });
  });

  test("last event wins when multiple rate_limit_events are emitted", async () => {
    const written: Record<string, string> = {};

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => { written[path] = content; },
      appendFileFn: async () => undefined,
      queryFn: () =>
        makeAsyncIterable([
          makeRateLimitEvent({ utilization: 0.5 }),
          makeRateLimitEvent({ utilization: 0.9, rateLimitType: "seven_day_sonnet", resetsAt: 1234 }),
          makeResultSuccess(),
        ]),
    };

    await main(deps);

    const parsedResult = JSON.parse(written["/tmp/ws/result.json"]!) as Record<string, unknown>;
    const ul = parsedResult.usageLimit as Record<string, unknown>;
    expect(ul.utilization).toBe(0.9);
    expect(ul.rateLimitType).toBe("seven_day_sonnet");
    expect(ul.resetsAt).toBe(1234);
  });

  test("usageLimit absent when no rate_limit_event emitted", async () => {
    const written: Record<string, string> = {};

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => { written[path] = content; },
      appendFileFn: async () => undefined,
      queryFn: () => makeAsyncIterable([makeResultSuccess()]),
    };

    await main(deps);

    const parsedResult = JSON.parse(written["/tmp/ws/result.json"]!) as Record<string, unknown>;
    expect(parsedResult.usageLimit).toBeUndefined();
  });

  test("usageLimit defined but sub-fields undefined when event omits optional fields", async () => {
    const written: Record<string, string> = {};

    const deps: Partial<EntrypointDeps> = {
      readFileFn: async () => VALID_AGENT_CONFIG,
      writeFileFn: async (path, content) => { written[path] = content; },
      appendFileFn: async () => undefined,
      queryFn: () =>
        makeAsyncIterable([
          makeRateLimitEvent({ status: "allowed" }), // no utilization/rateLimitType/resetsAt
          makeResultSuccess(),
        ]),
    };

    await main(deps);

    const parsedResult = JSON.parse(written["/tmp/ws/result.json"]!) as Record<string, unknown>;
    const ul = parsedResult.usageLimit as Record<string, unknown> | undefined;
    expect(ul).toBeDefined();
    expect(ul!.utilization).toBeUndefined();
    expect(ul!.rateLimitType).toBeUndefined();
    expect(ul!.resetsAt).toBeUndefined();
  });
});
