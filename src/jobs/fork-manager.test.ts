import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { BotUserClient } from "../auth/bot-user.ts";
import { createForkManager } from "./fork-manager.ts";

type LogCall = { bindings: Record<string, unknown>; message: string };

function createMockLogger() {
  const debugCalls: LogCall[] = [];
  const infoCalls: LogCall[] = [];
  const warnCalls: LogCall[] = [];
  const errorCalls: LogCall[] = [];
  return {
    logger: createMockLoggerWithArrays(debugCalls, infoCalls, warnCalls, errorCalls),
    debugCalls,
    infoCalls,
    warnCalls,
    errorCalls,
  };
}

function createMockLoggerWithArrays(
  debugCalls: LogCall[],
  infoCalls: LogCall[],
  warnCalls: LogCall[],
  errorCalls: LogCall[],
): Logger {
  const trace = mock(() => undefined);
  const fatal = mock(() => undefined);
  return {
    debug: (bindings: Record<string, unknown>, message: string) => {
      debugCalls.push({ bindings, message });
    },
    info: (bindings: Record<string, unknown>, message: string) => {
      infoCalls.push({ bindings, message });
    },
    warn: (bindings: Record<string, unknown>, message: string) => {
      warnCalls.push({ bindings, message });
    },
    error: (bindings: Record<string, unknown>, message: string) => {
      errorCalls.push({ bindings, message });
    },
    trace,
    fatal,
    child: () => createMockLoggerWithArrays(debugCalls, infoCalls, warnCalls, errorCalls),
  } as unknown as Logger;
}

function createEnabledBotClient(overrides?: {
  login?: string;
  reposGet?: ReturnType<typeof mock>;
  createFork?: ReturnType<typeof mock>;
  request?: ReturnType<typeof mock>;
  deleteRef?: ReturnType<typeof mock>;
}): BotUserClient {
  const reposGet =
    overrides?.reposGet ??
    mock(async (params: { owner: string; repo: string }) => ({
      data: {
        full_name: `${params.owner}/${params.repo}`,
        source: undefined,
      },
    }));
  const createFork = overrides?.createFork ?? mock(async () => ({ data: {} }));
  const request = overrides?.request ?? mock(async () => ({ data: {} }));
  const deleteRef = overrides?.deleteRef ?? mock(async () => ({ data: {} }));

  return {
    enabled: true,
    login: overrides?.login ?? "kodiai-bot",
    octokit: {
      rest: {
        repos: {
          get: reposGet,
          createFork,
        },
        git: {
          deleteRef,
        },
      },
      request,
    } as unknown as BotUserClient["octokit"],
  };
}

describe("createForkManager", () => {
  const originalSetTimeout = globalThis.setTimeout;

  beforeEach(() => {
    globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0]) => {
      if (typeof handler === "function") {
        handler();
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof globalThis.setTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
  });

  test("disabled mode throws from all operations", async () => {
    const { logger } = createMockLogger();
    const manager = createForkManager(
      {
        enabled: false,
        login: "",
        octokit: {} as BotUserClient["octokit"],
      },
      logger,
    );

    expect(manager.enabled).toBe(false);
    expect(() => manager.getBotPat()).toThrow("Fork manager is not available. Bot user client is not configured.");
    await expect(manager.ensureFork("xbmc", "xbmc")).rejects.toThrow(
      "Fork manager is not available. Bot user client is not configured.",
    );
    await expect(manager.syncFork("kodiai-bot", "xbmc", "main")).rejects.toThrow(
      "Fork manager is not available. Bot user client is not configured.",
    );
    await expect(manager.deleteForkBranch("kodiai-bot", "xbmc", "feature")).rejects.toThrow(
      "Fork manager is not available. Bot user client is not configured.",
    );
  });

  test("ensureFork reuses the in-memory cache and logs the cache hit", async () => {
    const { logger, debugCalls, infoCalls } = createMockLogger();
    const reposGet = mock(async (params: { owner: string; repo: string }) => ({
      data: {
        full_name: `${params.owner}/${params.repo}`,
        source: {
          full_name: "xbmc/xbmc",
        },
      },
    }));
    const createFork = mock(async () => {
      throw new Error("should not create a fork when one already exists");
    });

    const manager = createForkManager(
      createEnabledBotClient({ reposGet, createFork }),
      logger,
      "ghp_test-token",
    );

    await expect(manager.ensureFork("xbmc", "xbmc")).resolves.toEqual({
      forkOwner: "kodiai-bot",
      forkRepo: "xbmc",
    });
    await expect(manager.ensureFork("xbmc", "xbmc")).resolves.toEqual({
      forkOwner: "kodiai-bot",
      forkRepo: "xbmc",
    });

    expect(reposGet).toHaveBeenCalledTimes(1);
    expect(createFork).not.toHaveBeenCalled();
    expect(infoCalls).toContainEqual({
      bindings: { owner: "xbmc", repo: "xbmc", forkOwner: "kodiai-bot", forkRepo: "xbmc" },
      message: "Found existing fork",
    });
    expect(debugCalls).toContainEqual({
      bindings: {
        owner: "xbmc",
        repo: "xbmc",
        cached: { forkOwner: "kodiai-bot", forkRepo: "xbmc" },
      },
      message: "Fork cache hit",
    });
  });

  test("ensureFork reuses an existing matching fork without creating a new fork", async () => {
    const { logger, infoCalls } = createMockLogger();
    const reposGet = mock(async () => ({
      data: {
        full_name: "kodiai-bot/xbmc",
        source: {
          full_name: "xbmc/xbmc",
        },
      },
    }));
    const createFork = mock(async () => ({ data: {} }));

    const manager = createForkManager(createEnabledBotClient({ reposGet, createFork }), logger, "ghp_test-token");

    await expect(manager.ensureFork("xbmc", "xbmc")).resolves.toEqual({
      forkOwner: "kodiai-bot",
      forkRepo: "xbmc",
    });

    expect(createFork).not.toHaveBeenCalled();
    expect(infoCalls).toContainEqual({
      bindings: { owner: "xbmc", repo: "xbmc", forkOwner: "kodiai-bot", forkRepo: "xbmc" },
      message: "Found existing fork",
    });
  });

  test("ensureFork creates a fork and polls through initial not-ready responses", async () => {
    const { logger, infoCalls } = createMockLogger();
    let callCount = 0;
    const reposGet = mock(async (params: { owner: string; repo: string }) => {
      callCount += 1;
      if (callCount === 1) {
        const error = Object.assign(new Error("Not Found"), { status: 404 });
        throw error;
      }
      if (callCount === 2) {
        const error = Object.assign(new Error("Fork not ready"), { status: 404 });
        throw error;
      }
      if (callCount === 3) {
        const error = Object.assign(new Error("Still provisioning"), { status: 404 });
        throw error;
      }
      return {
        data: {
          full_name: `${params.owner}/${params.repo}`,
          source: {
            full_name: "xbmc/xbmc",
          },
        },
      };
    });
    const createFork = mock(async () => ({ data: {} }));

    const manager = createForkManager(createEnabledBotClient({ reposGet, createFork }), logger, "ghp_test-token");

    await expect(manager.ensureFork("xbmc", "xbmc")).resolves.toEqual({
      forkOwner: "kodiai-bot",
      forkRepo: "xbmc",
    });

    expect(createFork).toHaveBeenCalledTimes(1);
    expect(createFork).toHaveBeenCalledWith({
      owner: "xbmc",
      repo: "xbmc",
      default_branch_only: true,
    });
    expect(reposGet).toHaveBeenCalledTimes(4);
    expect(infoCalls).toContainEqual({
      bindings: { owner: "xbmc", repo: "xbmc" },
      message: "Creating fork",
    });
    expect(infoCalls).toContainEqual({
      bindings: { owner: "xbmc", repo: "xbmc", forkOwner: "kodiai-bot", forkRepo: "xbmc" },
      message: "Fork created and ready",
    });
  });

  test("syncFork rewrites 409 conflicts into a descriptive error and logs a warning", async () => {
    const { logger, debugCalls, warnCalls } = createMockLogger();
    const request = mock(async () => {
      const error = Object.assign(new Error("Conflict"), { status: 409 });
      throw error;
    });

    const manager = createForkManager(createEnabledBotClient({ request }), logger, "ghp_test-token");

    await expect(manager.syncFork("kodiai-bot", "xbmc", "main")).rejects.toThrow(
      "Merge conflict syncing fork kodiai-bot/xbmc branch main with upstream. A git-based fallback may be needed.",
    );

    expect(request).toHaveBeenCalledWith("POST /repos/{owner}/{repo}/merge-upstream", {
      owner: "kodiai-bot",
      repo: "xbmc",
      branch: "main",
    });
    expect(debugCalls).toContainEqual({
      bindings: { forkOwner: "kodiai-bot", forkRepo: "xbmc", branch: "main" },
      message: "Syncing fork with upstream",
    });
    expect(warnCalls).toContainEqual({
      bindings: {
        forkOwner: "kodiai-bot",
        forkRepo: "xbmc",
        branch: "main",
        errorName: "Error",
        errorStatus: 409,
        errorMessage: "Conflict",
      },
      message: "Fork sync hit merge conflict",
    });
  });

  test("deleteForkBranch is best-effort and logs failures", async () => {
    const { logger, warnCalls } = createMockLogger();
    const deleteRef = mock(async () => {
      throw new Error("network down");
    });

    const manager = createForkManager(createEnabledBotClient({ deleteRef }), logger, "ghp_test-token");

    await expect(manager.deleteForkBranch("kodiai-bot", "xbmc", "feature/test")).resolves.toBeUndefined();

    expect(deleteRef).toHaveBeenCalledWith({
      owner: "kodiai-bot",
      repo: "xbmc",
      ref: "heads/feature/test",
    });
    expect(warnCalls).toContainEqual({
      bindings: {
        forkOwner: "kodiai-bot",
        forkRepo: "xbmc",
        branch: "feature/test",
        errorName: "Error",
        errorMessage: "network down",
      },
      message: "Failed to delete fork branch (best-effort)",
    });
  });

  test("getBotPat throws when the PAT is absent", () => {
    const { logger } = createMockLogger();
    const manager = createForkManager(createEnabledBotClient(), logger);

    expect(() => manager.getBotPat()).toThrow("Bot PAT not provided to ForkManager");
  });
});
