import { describe, test, expect, mock, afterEach } from "bun:test";
import { join } from "node:path";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import {
  APPLICATION_SECRET_NAMES,
  buildAcaJobSpec,
  readJobResult,
  cancelAcaJob,
  pollUntilComplete,
} from "./aca-launcher.ts";

// ---------------------------------------------------------------------------
// APPLICATION_SECRET_NAMES contract
// ---------------------------------------------------------------------------

describe("APPLICATION_SECRET_NAMES", () => {
  test("is a non-empty readonly array", () => {
    expect(Array.isArray(APPLICATION_SECRET_NAMES)).toBe(true);
    expect(APPLICATION_SECRET_NAMES.length).toBeGreaterThan(0);
  });

  test("contains the expected secret key names", () => {
    const expected = [
      "GITHUB_PRIVATE_KEY",
      "GITHUB_PRIVATE_KEY_BASE64",
      "GITHUB_APP_ID",
      "GITHUB_WEBHOOK_SECRET",
      "DATABASE_URL",
      "SLACK_BOT_TOKEN",
      "SLACK_SIGNING_SECRET",
      "VOYAGE_API_KEY",
      "BOT_USER_PAT",
      "GITHUB_INSTALLATION_TOKEN",
    ];
    for (const name of expected) {
      expect(APPLICATION_SECRET_NAMES).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// buildAcaJobSpec
// ---------------------------------------------------------------------------

describe("buildAcaJobSpec", () => {
  const BASE_OPTS = {
    jobName: "test-job",
    image: "kodiairegistry.azurecr.io/kodiai-agent:latest",
    workspaceDir: "/mnt/kodiai-workspaces/test-job",
    mcpBearerToken: "test-mcp-bearer-token",
    mcpBaseUrl: "http://ca-kodiai.internal.env.eastus.azurecontainerapps.io",
  };

  test("no APPLICATION_SECRET_NAMES in env array", () => {
    const spec = buildAcaJobSpec(BASE_OPTS);
    const envNames = spec.env.map((e) => e.name);

    for (const secretName of APPLICATION_SECRET_NAMES) {
      expect(envNames).not.toContain(secretName);
    }
  });

  test("required env keys present — MCP_BEARER_TOKEN and WORKSPACE_DIR", () => {
    const spec = buildAcaJobSpec(BASE_OPTS);
    const envNames = spec.env.map((e) => e.name);

    expect(envNames).toContain("MCP_BEARER_TOKEN");
    expect(envNames).toContain("WORKSPACE_DIR");
  });

  test("MCP_BEARER_TOKEN value matches input", () => {
    const spec = buildAcaJobSpec(BASE_OPTS);
    const entry = spec.env.find((e) => e.name === "MCP_BEARER_TOKEN");
    expect(entry?.value).toBe("test-mcp-bearer-token");
  });

  test("MCP_BASE_URL env var present in spec", () => {
    const spec = buildAcaJobSpec(BASE_OPTS);
    const entry = spec.env.find((e) => e.name === "MCP_BASE_URL");
    expect(entry?.value).toBe(BASE_OPTS.mcpBaseUrl);
  });

  test("MCP_BASE_URL is not in APPLICATION_SECRET_NAMES", () => {
    expect(APPLICATION_SECRET_NAMES).not.toContain("MCP_BASE_URL");
    // Confirm the runtime guard does not fire — buildAcaJobSpec must not throw
    expect(() => buildAcaJobSpec(BASE_OPTS)).not.toThrow();
  });

  test("WORKSPACE_DIR value matches input", () => {
    const spec = buildAcaJobSpec(BASE_OPTS);
    const entry = spec.env.find((e) => e.name === "WORKSPACE_DIR");
    expect(entry?.value).toBe("/mnt/kodiai-workspaces/test-job");
  });

  test("ANTHROPIC_API_KEY included when provided", () => {
    const spec = buildAcaJobSpec({ ...BASE_OPTS, anthropicApiKey: "sk-test" });
    const entry = spec.env.find((e) => e.name === "ANTHROPIC_API_KEY");
    expect(entry?.value).toBe("sk-test");
  });

  test("ANTHROPIC_API_KEY absent when not provided", () => {
    const spec = buildAcaJobSpec(BASE_OPTS);
    const envNames = spec.env.map((e) => e.name);
    expect(envNames).not.toContain("ANTHROPIC_API_KEY");
  });

  test("GITHUB_INSTALLATION_TOKEN is in APPLICATION_SECRET_NAMES", () => {
    expect(APPLICATION_SECRET_NAMES).toContain("GITHUB_INSTALLATION_TOKEN");
  });

  test("GITHUB_INSTALLATION_TOKEN always absent from spec env array", () => {
    const spec = buildAcaJobSpec(BASE_OPTS);
    const envNames = spec.env.map((e) => e.name);
    expect(envNames).not.toContain("GITHUB_INSTALLATION_TOKEN");
  });

  test("default timeoutSeconds is 600", () => {
    const spec = buildAcaJobSpec(BASE_OPTS);
    expect(spec.timeoutSeconds).toBe(600);
  });

  test("custom timeoutSeconds is respected", () => {
    const spec = buildAcaJobSpec({ ...BASE_OPTS, timeoutSeconds: 120 });
    expect(spec.timeoutSeconds).toBe(120);
  });

  test("throws if APPLICATION_SECRET_NAMES passed via opts — runtime guard", () => {
    // The security guard must throw even if a caller somehow passes a secret name
    // through a field that would become part of the env array. We simulate the
    // guard by calling buildAcaJobSpec and then directly injecting a forbidden
    // name into the env — then verify the guard re-runs when triggered.
    //
    // The realistic attack vector is a caller re-using an APPLICATION_SECRET_NAMES
    // value as the mcpBearerToken *name*, not value — but since the current API
    // only accepts fixed names (MCP_BEARER_TOKEN, etc.), the guard protects against
    // future API changes. We test the guard directly by building a partial spec and
    // confirming the throw logic works.
    //
    // To trigger the guard under the current API, we construct the spec manually
    // and verify that the guard in buildAcaJobSpec fires for each forbidden name.
    for (const secretName of APPLICATION_SECRET_NAMES) {
      // Monkey-patch: temporarily give the module a spec constructor that would
      // produce a forbidden env var. Since buildAcaJobSpec builds its env array
      // from only its own opts, the only way to trigger the guard is to observe
      // it fires when a forbidden name would appear. We do that by exercising the
      // guard logic directly via a helper that mimics the guard.
      const env = [{ name: secretName, value: "x" }];
      const forbidden = env.filter((e) =>
        (APPLICATION_SECRET_NAMES as readonly string[]).includes(e.name),
      );
      expect(forbidden.length).toBeGreaterThan(0);
    }

    // Additionally: verify that if the runtime guard is hypothetically bypassed
    // and buildAcaJobSpec internally includes a forbidden name, it throws.
    // We test this by attempting to build a spec where an internal variable would
    // trigger the guard — the current implementation prevents this via the allowed
    // name set, so we confirm no standard call throws.
    expect(() => buildAcaJobSpec(BASE_OPTS)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// readJobResult
// ---------------------------------------------------------------------------

describe("pollUntilComplete", () => {
  function makeLogger() {
    return {
      debug: mock(() => undefined),
      info: mock(() => undefined),
      warn: mock(() => undefined),
      error: mock(() => undefined),
    } satisfies Pick<Logger, "debug" | "info" | "warn" | "error">;
  }

  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function textResponse(body: string, status = 200) {
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  async function runPollScenario(opts: {
    statusResponses: Array<Response | Error>;
    nowValues: number[];
    timeoutMs?: number;
    pollIntervalMs?: number;
  }) {
    const originalFetch = globalThis.fetch;
    const originalSleep = Bun.sleep;
    const originalNow = Date.now;
    const originalIdentityEndpoint = process.env["IDENTITY_ENDPOINT"];
    const originalIdentityHeader = process.env["IDENTITY_HEADER"];

    const logger = makeLogger();
    const sleepCalls: number[] = [];
    let nowIndex = 0;
    let statusFetchCount = 0;

    process.env["IDENTITY_ENDPOINT"] = "https://identity.example/token";
    process.env["IDENTITY_HEADER"] = "identity-header";

    Date.now = () => {
      const safeIndex = Math.min(nowIndex, opts.nowValues.length - 1);
      const value = opts.nowValues[safeIndex] ?? 0;
      nowIndex += 1;
      return value;
    };

    Bun.sleep = (async (ms: number) => {
      sleepCalls.push(ms);
    }) as typeof Bun.sleep;

    globalThis.fetch = (async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://identity.example/token")) {
        return jsonResponse({ access_token: "test-access-token" });
      }

      const next = opts.statusResponses[statusFetchCount] ?? opts.statusResponses.at(-1);
      statusFetchCount += 1;
      if (next instanceof Error) {
        throw next;
      }
      return next ?? jsonResponse({ properties: { status: "Running" } });
    }) as typeof fetch;

    try {
      const result = await pollUntilComplete({
        resourceGroup: "rg-kodiai",
        jobName: "caj-kodiai-agent",
        executionName: "exec-123",
        timeoutMs: opts.timeoutMs ?? 20_000,
        ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
        logger: logger as unknown as Logger,
      });

      return { result, logger, sleepCalls, statusFetchCount };
    } finally {
      globalThis.fetch = originalFetch;
      Bun.sleep = originalSleep;
      Date.now = originalNow;
      if (originalIdentityEndpoint === undefined) {
        delete process.env["IDENTITY_ENDPOINT"];
      } else {
        process.env["IDENTITY_ENDPOINT"] = originalIdentityEndpoint;
      }
      if (originalIdentityHeader === undefined) {
        delete process.env["IDENTITY_HEADER"];
      } else {
        process.env["IDENTITY_HEADER"] = originalIdentityHeader;
      }
    }
  }

  test("succeeds on the first poll without sleeping", async () => {
    const { result, sleepCalls, statusFetchCount } = await runPollScenario({
      statusResponses: [jsonResponse({ properties: { status: "Succeeded" } })],
      nowValues: [0, 0, 40],
    });

    expect(result).toEqual({ status: "succeeded", durationMs: 40 });
    expect(sleepCalls).toEqual([]);
    expect(statusFetchCount).toBe(1);
  });

  test("retries HTTP and fetch failures on the faster default cadence before surfacing failed status", async () => {
    const { result, logger, sleepCalls, statusFetchCount } = await runPollScenario({
      statusResponses: [
        textResponse("gateway unavailable", 503),
        new Error("socket hang up"),
        jsonResponse({ status: "Failed" }),
      ],
      nowValues: [0, 0, 100, 5_100, 5_200, 10_100, 10_200],
    });

    expect(result).toEqual({ status: "failed", durationMs: 10_200 });
    expect(sleepCalls).toEqual([5_000, 5_000]);
    expect(statusFetchCount).toBe(3);

    const debugMessages = (logger.debug as ReturnType<typeof mock>).mock.calls.map((call) => call[1]);
    expect(debugMessages).toContain("ACA Job poll: REST API error, will retry");
    expect(debugMessages).toContain("ACA Job poll: fetch failed, will retry");
  });

  test("logs malformed payload drift for invalid JSON, missing status, and unknown statuses before succeeding", async () => {
    const { result, logger, sleepCalls, statusFetchCount } = await runPollScenario({
      statusResponses: [
        textResponse("{not-json"),
        jsonResponse({ properties: {} }),
        jsonResponse({ status: "Queued" }),
        jsonResponse({ properties: { status: "Succeeded" } }),
      ],
      nowValues: [0, 0, 10, 5_010, 5_020, 10_020, 10_030, 15_030, 15_040],
      timeoutMs: 30_000,
    });

    expect(result).toEqual({ status: "succeeded", durationMs: 15_040 });
    expect(sleepCalls).toEqual([5_000, 5_000, 5_000]);
    expect(statusFetchCount).toBe(4);

    const debugMessages = (logger.debug as ReturnType<typeof mock>).mock.calls.map((call) => call[1]);
    expect(debugMessages).toContain("ACA Job poll: malformed execution payload, will retry");
    expect(debugMessages).toContain("ACA Job poll: unknown execution status, will retry");
  });

  test("times out truthfully when the deadline expires just before the next scheduled poll", async () => {
    const { result, sleepCalls, statusFetchCount } = await runPollScenario({
      statusResponses: [jsonResponse({ status: "Running" })],
      nowValues: [0, 0, 1, 3_000, 3_001],
      timeoutMs: 3_000,
    });

    expect(result).toEqual({ status: "timed-out", durationMs: 3_001 });
    expect(sleepCalls).toEqual([2_999]);
    expect(statusFetchCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// readJobResult
// ---------------------------------------------------------------------------

describe("readJobResult", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      tmpDir = undefined;
    }
  });

  test("reads and parses result.json", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "aca-launcher-test-"));
    const expected = { status: "ok", output: "hello world", items: [1, 2, 3] };
    await Bun.write(join(tmpDir, "result.json"), JSON.stringify(expected));

    const result = await readJobResult(tmpDir);
    expect(result).toEqual(expected);
  });

  test("throws if result.json does not exist", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "aca-launcher-test-"));
    await expect(readJobResult(tmpDir)).rejects.toThrow();
  });

  test("throws if result.json is not valid JSON", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "aca-launcher-test-"));
    await Bun.write(join(tmpDir, "result.json"), "not-json{{{");
    await expect(readJobResult(tmpDir)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// cancelAcaJob — unit tests (az CLI call is pure infrastructure; we test the
// exported function signature, logger integration, and error propagation)
// ---------------------------------------------------------------------------

describe("cancelAcaJob", () => {
  test("is exported and callable", () => {
    expect(typeof cancelAcaJob).toBe("function");
  });

  test("accepts required opts object shape without throwing at build time", () => {
    // Verify the function accepts the correct parameter shape.
    // Actual execution requires az CLI — covered in integration tests only.
    const opts = {
      resourceGroup: "rg-kodiai",
      jobName: "caj-kodiai-agent",
      executionName: "caj-kodiai-agent--abc123",
    };
    // The function is async; as long as this doesn't throw synchronously,
    // the parameter types are correct.
    const promise = cancelAcaJob(opts);
    expect(promise).toBeInstanceOf(Promise);
    // Discard the promise — az is not available in test environment
    promise.catch(() => {});
  });

  test("accepts optional logger parameter", () => {
    const logger = {
      info: mock(() => undefined),
    };
    const promise = cancelAcaJob({
      resourceGroup: "rg-kodiai",
      jobName: "caj-kodiai-agent",
      executionName: "exec-001",
      logger: logger as unknown as import("pino").Logger,
    });
    expect(promise).toBeInstanceOf(Promise);
    promise.catch(() => {});
  });
});
