import { describe, expect, test } from "bun:test";
import type { ForkManager } from "../jobs/fork-manager.ts";
import { resolveMentionForkContext } from "./mention-fork-context.ts";

function makeLogger() {
  const info: Array<{ fields: unknown; message: string }> = [];
  const warn: Array<{ fields: unknown; message: string }> = [];
  return {
    info,
    warn,
    logger: {
      info: (fields: unknown, message: string) => {
        info.push({ fields, message });
      },
      warn: (fields: unknown, message: string) => {
        warn.push({ fields, message });
      },
    },
  };
}

function makeForkManager(overrides: Partial<ForkManager> = {}): ForkManager {
  return {
    enabled: true,
    ensureFork: async () => ({ forkOwner: "bot", forkRepo: "repo" }),
    syncFork: async () => undefined,
    deleteForkBranch: async () => undefined,
    getBotPat: () => "bot-pat",
    ...overrides,
  };
}

describe("resolveMentionForkContext", () => {
  test("ensures and syncs a fork for non-plan write intent before workspace creation", async () => {
    const calls: string[] = [];
    const { logger, info, warn } = makeLogger();

    const forkContext = await resolveMentionForkContext({
      forkManager: makeForkManager({
        ensureFork: async (owner, repo) => {
          calls.push(`ensure:${owner}/${repo}`);
          return { forkOwner: "bot", forkRepo: "repo" };
        },
        syncFork: async (forkOwner, forkRepo, branch) => {
          calls.push(`sync:${forkOwner}/${forkRepo}:${branch}`);
        },
        getBotPat: () => {
          calls.push("pat");
          return "bot-pat";
        },
      }),
      appSlug: "kodiai",
      commentBody: "@kodiai apply: the patch",
      owner: "octo",
      repo: "repo",
      cloneRef: "feature",
      usesPrRef: false,
      logger,
    });

    expect(forkContext).toEqual({
      forkOwner: "bot",
      forkRepo: "repo",
      botPat: "bot-pat",
    });
    expect(calls).toEqual([
      "ensure:octo/repo",
      "sync:bot/repo:feature",
      "pat",
    ]);
    expect(info.map((entry) => entry.message)).toContain("Fork ensured and synced for write-mode");
    expect(warn).toHaveLength(0);
  });

  test("returns undefined and warns when write intent exists without an enabled fork manager", async () => {
    const { logger, warn } = makeLogger();

    const forkContext = await resolveMentionForkContext({
      forkManager: undefined,
      appSlug: "kodiai",
      commentBody: "@kodiai apply: the patch",
      owner: "octo",
      repo: "repo",
      cloneRef: "feature",
      usesPrRef: false,
      logger,
    });

    expect(forkContext).toBeUndefined();
    expect(warn.map((entry) => entry.message)).toContain(
      "Write-mode active without BOT_USER_PAT; using legacy direct-push behavior",
    );
  });

  test("fails open when fork setup throws", async () => {
    const { logger, warn } = makeLogger();

    const forkContext = await resolveMentionForkContext({
      forkManager: makeForkManager({
        ensureFork: async () => {
          throw new Error("fork unavailable");
        },
      }),
      appSlug: "kodiai",
      commentBody: "@kodiai apply: the patch",
      owner: "octo",
      repo: "repo",
      cloneRef: "feature",
      usesPrRef: false,
      logger,
    });

    expect(forkContext).toBeUndefined();
    expect(warn.map((entry) => entry.message)).toContain(
      "Fork setup failed; will fall back to gist or legacy mode",
    );
  });

  test("skips fork setup for plan-only write intent", async () => {
    const { logger, info, warn } = makeLogger();
    let ensureCalled = false;

    const forkContext = await resolveMentionForkContext({
      forkManager: makeForkManager({
        ensureFork: async () => {
          ensureCalled = true;
          return { forkOwner: "bot", forkRepo: "repo" };
        },
      }),
      appSlug: "kodiai",
      commentBody: "@kodiai plan the patch",
      owner: "octo",
      repo: "repo",
      cloneRef: "feature",
      usesPrRef: false,
      logger,
    });

    expect(forkContext).toBeUndefined();
    expect(ensureCalled).toBe(false);
    expect(info).toHaveLength(0);
    expect(warn).toHaveLength(0);
  });
});
