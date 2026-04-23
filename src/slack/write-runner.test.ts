import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createSlackWriteRunner } from "./write-runner.ts";
import { WritePolicyError } from "../jobs/workspace.ts";

const TEST_INPUT = {
  owner: "xbmc",
  repo: "xbmc",
  channel: "C123",
  threadTs: "1700000000.000111",
  messageTs: "1700000000.000222",
  prompt: "apply update",
  request: "update src/file.ts",
  keyword: "apply" as const,
};

type TestWorkspace = {
  dir: string;
  cleanup: () => Promise<void>;
};

type TestLogger = {
  warn: Array<{ payload: Record<string, unknown>; message: string }>;
  info: Array<{ payload: Record<string, unknown>; message: string }>;
  error: Array<{ payload: Record<string, unknown>; message: string }>;
  logger: {
    warn: (payload: Record<string, unknown>, message: string) => void;
    info: (payload: Record<string, unknown>, message: string) => void;
    error: (payload: Record<string, unknown>, message: string) => void;
  };
};

const tempDirs: string[] = [];

async function createGitWorkspace(options?: {
  originOwner?: string;
  originRepo?: string;
  defaultBranch?: string;
  files?: Record<string, string>;
}): Promise<TestWorkspace> {
  const dir = await mkdtemp(join(tmpdir(), "slack-write-runner-"));
  tempDirs.push(dir);

  const originOwner = options?.originOwner ?? "xbmc-bot";
  const originRepo = options?.originRepo ?? "xbmc";
  const defaultBranch = options?.defaultBranch ?? "main";
  const files = options?.files ?? { "src/file.ts": "export const value = 1;\n" };

  await Bun.$`git -C ${dir} init -b ${defaultBranch}`.quiet();
  await Bun.$`git -C ${dir} config user.name test`.quiet();
  await Bun.$`git -C ${dir} config user.email test@example.com`.quiet();

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath);
    await Bun.file(fullPath).write(content);
  }

  await Bun.$`git -C ${dir} add -A`.quiet();
  await Bun.$`git -C ${dir} commit -m initial`.quiet();
  await Bun.$`git -C ${dir} remote add origin https://github.com/${originOwner}/${originRepo}.git`.quiet();

  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function createLogger(): TestLogger {
  const warn: TestLogger["warn"] = [];
  const info: TestLogger["info"] = [];
  const error: TestLogger["error"] = [];

  return {
    warn,
    info,
    error,
    logger: {
      warn: (payload, message) => warn.push({ payload, message }),
      info: (payload, message) => info.push({ payload, message }),
      error: (payload, message) => error.push({ payload, message }),
    },
  };
}

async function overwriteFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
}

beforeEach(() => {
  tempDirs.length = 0;
});

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createSlackWriteRunner", () => {
  test("routes fork single-file changes to a patch gist and preserves mirrored comments", async () => {
    const workspace = await createGitWorkspace();
    const logger = createLogger();
    const gistCalls: Array<Record<string, unknown>> = [];
    const prCalls: Array<Record<string, unknown>> = [];
    const commitCalls: Array<Record<string, unknown>> = [];
    const forkCalls: string[] = [];

    const runner = createSlackWriteRunner({
      resolveRepoInstallationContext: async () => ({ installationId: 42, defaultBranch: "main" }),
      createWorkspace: async () => workspace as never,
      loadRepoConfig: async () => ({
        config: {
          write: {
            enabled: true,
            allowPaths: ["src/**"],
            denyPaths: [],
            secretScan: { enabled: true },
          },
        } as never,
        warnings: [],
      }),
      forkManager: {
        enabled: true,
        ensureFork: async () => {
          forkCalls.push("ensureFork");
          return { forkOwner: "xbmc-bot", forkRepo: "xbmc" };
        },
        syncFork: async () => {
          forkCalls.push("syncFork");
        },
        deleteForkBranch: async () => undefined,
        getBotPat: () => "bot-pat",
      },
      gistPublisher: {
        enabled: true,
        createPatchGist: async (input) => {
          gistCalls.push(input as unknown as Record<string, unknown>);
          return { htmlUrl: "https://gist.github.com/kodiai/g1", id: "g1" };
        },
      },
      execute: async () => {
        await overwriteFiles(workspace.dir, { "src/file.ts": "export const value = 2;\n" });
        return {
          conclusion: "success",
          costUsd: 0,
          numTurns: 1,
          durationMs: 100,
          sessionId: "session-1",
          published: true,
          errorMessage: undefined,
          model: "test-model",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          resultText: "Applied changes",
          publishEvents: [
            {
              type: "comment",
              url: "https://github.com/xbmc/xbmc/issues/12#issuecomment-99",
              excerpt: "Posted follow-up comment",
            },
          ],
        };
      },
      commitBranchAndPush: async (input) => {
        commitCalls.push(input as unknown as Record<string, unknown>);
        return { branchName: "kodiai/slack/apply-abc123", headSha: "deadbeef" };
      },
      createPullRequest: async (input) => {
        prCalls.push(input as unknown as Record<string, unknown>);
        return { htmlUrl: "https://github.com/xbmc/xbmc/pull/321" };
      },
      logger: logger.logger as never,
    });

    const result = await runner.run(TEST_INPUT);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") throw new Error("expected success");

    expect(result.gistUrl).toBe("https://gist.github.com/kodiai/g1");
    expect(result.prUrl).toBeUndefined();
    expect(result.responseText).toContain("Created patch gist: https://gist.github.com/kodiai/g1");
    expect(result.responseText).toContain("curl -sL https://gist.github.com/kodiai/g1.patch | git apply");
    expect(result.mirrors).toEqual([
      {
        url: "https://github.com/xbmc/xbmc/issues/12#issuecomment-99",
        excerpt: "Posted follow-up comment",
      },
    ]);

    expect(forkCalls).toEqual(["ensureFork", "syncFork"]);
    expect(gistCalls).toHaveLength(1);
    expect(gistCalls[0]!).toMatchObject({
      owner: "xbmc",
      repo: "xbmc",
      summary: "update src/file.ts",
    });
    expect(String(gistCalls[0]!.patch)).toContain("+export const value = 2;");
    expect(commitCalls).toHaveLength(0);
    expect(prCalls).toHaveLength(0);
    expect(logger.info).toContainEqual({
      payload: { owner: "xbmc", repo: "xbmc", forkOwner: "xbmc-bot" },
      message: "Fork ensured and synced for Slack write-mode",
    });
  });

  test("falls back from fork PR creation to a patch gist and logs the warning", async () => {
    const workspace = await createGitWorkspace({
      files: {
        "src/file.ts": "export const value = 1;\n",
        "src/other.ts": "export const other = 1;\n",
        "README.md": "# repo\n",
        "docs/notes.md": "hello\n",
      },
    });
    const logger = createLogger();
    const gistCalls: Array<Record<string, unknown>> = [];
    const commitCalls: Array<Record<string, unknown>> = [];
    const prCalls: Array<Record<string, unknown>> = [];

    const runner = createSlackWriteRunner({
      resolveRepoInstallationContext: async () => ({ installationId: 42, defaultBranch: "main" }),
      createWorkspace: async () => workspace as never,
      loadRepoConfig: async () => ({
        config: {
          write: {
            enabled: true,
            allowPaths: ["src/**"],
            denyPaths: [],
            secretScan: { enabled: true },
          },
        } as never,
        warnings: [],
      }),
      forkManager: {
        enabled: true,
        ensureFork: async () => ({ forkOwner: "xbmc-bot", forkRepo: "xbmc" }),
        syncFork: async () => undefined,
        deleteForkBranch: async () => undefined,
        getBotPat: () => "bot-pat",
      },
      gistPublisher: {
        enabled: true,
        createPatchGist: async (input) => {
          gistCalls.push(input as unknown as Record<string, unknown>);
          return { htmlUrl: "https://gist.github.com/kodiai/fallback", id: "fallback" };
        },
      },
      execute: async () => {
        await overwriteFiles(workspace.dir, {
          "src/file.ts": "export const value = 2;\n",
          "src/other.ts": "export const other = 2;\n",
          "src/third.ts": "export const third = 2;\n",
          "README.md": "# changed\n",
        });
        return {
          conclusion: "success",
          costUsd: 0,
          numTurns: 1,
          durationMs: 100,
          sessionId: "session-1",
          published: true,
          errorMessage: undefined,
          model: "test-model",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          resultText: "Applied changes",
          publishEvents: [
            {
              type: "comment",
              url: "https://github.com/xbmc/xbmc/pull/55#issuecomment-88",
              excerpt: "Mirror survives gist fallback",
            },
          ],
        };
      },
      commitBranchAndPush: async (input) => {
        commitCalls.push(input as unknown as Record<string, unknown>);
        throw new Error("push failed");
      },
      createPullRequest: async (input) => {
        prCalls.push(input as unknown as Record<string, unknown>);
        return { htmlUrl: "https://github.com/xbmc/xbmc/pull/321" };
      },
      logger: logger.logger as never,
    });

    const result = await runner.run({
      ...TEST_INPUT,
      request: "fix files across the repo",
    });

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") throw new Error("expected success");

    expect(result.gistUrl).toBe("https://gist.github.com/kodiai/fallback");
    expect(result.prUrl).toBeUndefined();
    expect(result.responseText).toContain("Could not create PR from fork, but here is the patch as a gist:");
    expect(result.responseText).toContain("https://gist.github.com/kodiai/fallback");
    expect(result.mirrors).toEqual([
      {
        url: "https://github.com/xbmc/xbmc/pull/55#issuecomment-88",
        excerpt: "Mirror survives gist fallback",
      },
    ]);

    expect(commitCalls).toHaveLength(1);
    expect(prCalls).toHaveLength(0);
    expect(gistCalls).toHaveLength(1);
    expect(String(gistCalls[0]!.patch)).toContain("+export const other = 2;");
    expect(logger.warn).toContainEqual({
      payload: { err: expect.any(Error), owner: "xbmc", repo: "xbmc" },
      message: "Fork-based PR creation failed; falling back to gist",
    });
  });

  test("returns write-policy refusal before gist fallback when fork commit is blocked", async () => {
    const workspace = await createGitWorkspace({
      files: {
        "src/file.ts": "export const value = 1;\n",
        "README.md": "# repo\n",
        "docs/notes.md": "hello\n",
        "package.json": '{"name":"test","version":"1.0.0"}\n',
      },
    });
    const gistCalls: Array<Record<string, unknown>> = [];
    const logger = createLogger();

    const runner = createSlackWriteRunner({
      resolveRepoInstallationContext: async () => ({ installationId: 42, defaultBranch: "main" }),
      createWorkspace: async () => workspace as never,
      loadRepoConfig: async () => ({
        config: {
          write: {
            enabled: true,
            allowPaths: ["src/**"],
            denyPaths: [],
            secretScan: { enabled: true },
          },
        } as never,
        warnings: [],
      }),
      forkManager: {
        enabled: true,
        ensureFork: async () => ({ forkOwner: "xbmc-bot", forkRepo: "xbmc" }),
        syncFork: async () => undefined,
        deleteForkBranch: async () => undefined,
        getBotPat: () => "bot-pat",
      },
      gistPublisher: {
        enabled: true,
        createPatchGist: async (input) => {
          gistCalls.push(input as unknown as Record<string, unknown>);
          return { htmlUrl: "https://gist.github.com/kodiai/blocked", id: "blocked" };
        },
      },
      execute: async () => {
        await overwriteFiles(workspace.dir, {
          "src/file.ts": "export const value = 2;\n",
          "README.md": "# change\n",
          "docs/notes.md": "hello\n",
          "package.json": '{"name":"test"}\n',
        });
        return {
          conclusion: "success",
          costUsd: 0,
          numTurns: 1,
          durationMs: 100,
          sessionId: "session-1",
          published: true,
          errorMessage: undefined,
          model: "test-model",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
        };
      },
      commitBranchAndPush: async () => {
        throw new WritePolicyError("write-policy-not-allowed", "blocked", {
          path: "README.md",
          rule: "allowPaths",
        });
      },
      createPullRequest: async () => ({ htmlUrl: "https://github.com/xbmc/xbmc/pull/321" }),
      logger: logger.logger as never,
    });

    const result = await runner.run({
      ...TEST_INPUT,
      request: "touch several top-level files",
    });

    expect(result.outcome).toBe("refusal");
    if (result.outcome !== "refusal") throw new Error("expected refusal");

    expect(result.reason).toBe("policy");
    expect(result.responseText).toContain("Reason: write-policy-not-allowed");
    expect(result.responseText).toContain("File: README.md");
    expect(result.responseText).toContain("Retry command: apply: touch several top-level files");
    expect(gistCalls).toHaveLength(0);
    expect(logger.warn).toContainEqual({
      payload: { err: expect.any(WritePolicyError), owner: "xbmc", repo: "xbmc" },
      message: "Fork-based PR creation failed; falling back to gist",
    });
  });

  test("uses legacy direct-push PR routing when fork and gist helpers are unavailable", async () => {
    const workspace = await createGitWorkspace();
    const logger = createLogger();
    const commitCalls: Array<Record<string, unknown>> = [];
    const prCalls: Array<Record<string, unknown>> = [];

    const runner = createSlackWriteRunner({
      resolveRepoInstallationContext: async () => ({ installationId: 42, defaultBranch: "main" }),
      createWorkspace: async () => workspace as never,
      loadRepoConfig: async () => ({
        config: {
          write: {
            enabled: true,
            allowPaths: ["src/**"],
            denyPaths: [],
            secretScan: { enabled: true },
          },
        } as never,
        warnings: [],
      }),
      execute: async () => {
        await overwriteFiles(workspace.dir, { "src/file.ts": "export const value = 2;\n" });
        return {
          conclusion: "success",
          costUsd: 0,
          numTurns: 1,
          durationMs: 100,
          sessionId: "session-1",
          published: true,
          errorMessage: undefined,
          model: "test-model",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          publishEvents: [
            {
              type: "comment",
              url: "https://github.com/xbmc/xbmc/issues/12#issuecomment-99",
              excerpt: "Posted follow-up comment",
            },
          ],
        };
      },
      commitBranchAndPush: async (input) => {
        commitCalls.push(input as unknown as Record<string, unknown>);
        return { branchName: "kodiai/slack/apply-abc123", headSha: "deadbeef" };
      },
      createPullRequest: async (input) => {
        prCalls.push(input as unknown as Record<string, unknown>);
        return { htmlUrl: "https://github.com/xbmc/xbmc/pull/321" };
      },
      logger: logger.logger as never,
    });

    const result = await runner.run(TEST_INPUT);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") throw new Error("expected success");

    expect(result.prUrl).toBe("https://github.com/xbmc/xbmc/pull/321");
    expect(result.gistUrl).toBeUndefined();
    expect(result.responseText).toContain("Opened PR: https://github.com/xbmc/xbmc/pull/321");
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]).toMatchObject({
      token: undefined,
      policy: {
        allowPaths: ["src/**"],
        denyPaths: [],
        secretScanEnabled: true,
      },
    });
    expect(prCalls).toHaveLength(1);
    expect(prCalls[0]).toMatchObject({
      head: "kodiai/slack/apply-abc123",
      base: "main",
    });
    expect(logger.warn).toContainEqual({
      payload: { owner: "xbmc", repo: "xbmc" },
      message: "Slack write-mode active without BOT_USER_PAT; using legacy direct-push behavior",
    });
  });

  test("returns success with PR URL and mirrored comment metadata", async () => {
    const executeCalls: Array<Record<string, unknown>> = [];
    const prCalls: Array<Record<string, unknown>> = [];
    const commitCalls: Array<Record<string, unknown>> = [];

    const runner = createSlackWriteRunner({
      resolveRepoInstallationContext: async () => ({ installationId: 42, defaultBranch: "main" }),
      createWorkspace: async () => ({
        dir: "/tmp/slack-write-runner",
        cleanup: async () => undefined,
      }),
      loadRepoConfig: async () => ({
        config: {
          write: {
            enabled: true,
            allowPaths: ["src/**"],
            denyPaths: [],
            secretScan: { enabled: true },
          },
        } as never,
        warnings: [],
      }),
      execute: async (input) => {
        executeCalls.push(input as unknown as Record<string, unknown>);
        return {
          conclusion: "success",
          costUsd: 0,
          numTurns: 1,
          durationMs: 100,
          sessionId: "session-1",
          published: true,
          errorMessage: undefined,
          model: "test-model",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          resultText: "Applied changes",
          publishEvents: [
            {
              type: "comment",
              url: "https://github.com/xbmc/xbmc/issues/12#issuecomment-99",
              excerpt: "Posted follow-up comment",
            },
          ],
        };
      },
      commitBranchAndPush: async (input) => {
        commitCalls.push(input as unknown as Record<string, unknown>);
        return { branchName: "kodiai/slack/apply-abc123", headSha: "deadbeef" };
      },
      createPullRequest: async (input) => {
        prCalls.push(input as unknown as Record<string, unknown>);
        return { htmlUrl: "https://github.com/xbmc/xbmc/pull/321" };
      },
    });

    const result = await runner.run(TEST_INPUT);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") throw new Error("expected success");

    expect(result.prUrl).toBe("https://github.com/xbmc/xbmc/pull/321");
    expect(result.responseText).toContain("Opened PR: https://github.com/xbmc/xbmc/pull/321");
    expect(result.responseText).toContain("Mirrored GitHub comments:");
    expect(result.responseText).toContain("https://github.com/xbmc/xbmc/issues/12#issuecomment-99");
    expect(result.mirrors).toEqual([
      {
        url: "https://github.com/xbmc/xbmc/issues/12#issuecomment-99",
        excerpt: "Posted follow-up comment",
      },
    ]);

    expect(executeCalls).toHaveLength(1);
    expect(executeCalls[0]).toMatchObject({
      owner: "xbmc",
      repo: "xbmc",
      installationId: 42,
      triggerBody: "update src/file.ts",
    });
    expect(commitCalls).toHaveLength(1);
    expect(prCalls).toHaveLength(1);
    expect(prCalls[0]).toMatchObject({ base: "main", owner: "xbmc", repo: "xbmc" });
  });

  test("returns policy refusal with exact retry command", async () => {
    const runner = createSlackWriteRunner({
      resolveRepoInstallationContext: async () => ({ installationId: 1, defaultBranch: "main" }),
      createWorkspace: async () => ({
        dir: "/tmp/slack-write-runner",
        cleanup: async () => undefined,
      }),
      loadRepoConfig: async () => ({
        config: {
          write: {
            enabled: true,
            allowPaths: ["src/**"],
            denyPaths: [],
            secretScan: { enabled: true },
          },
        } as never,
        warnings: [],
      }),
      execute: async () => ({
        conclusion: "success",
        costUsd: 0,
        numTurns: 1,
        durationMs: 1,
        sessionId: "session",
        published: false,
        errorMessage: undefined,
        model: "model",
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        stopReason: "end_turn",
      }),
      commitBranchAndPush: async () => {
        throw new WritePolicyError("write-policy-not-allowed", "blocked", {
          path: "src/secret.ts",
          rule: "allowPaths",
        });
      },
      createPullRequest: async () => ({ htmlUrl: "https://github.com/xbmc/xbmc/pull/1" }),
    });

    const result = await runner.run({
      owner: "xbmc",
      repo: "xbmc",
      channel: "C1",
      threadTs: "170",
      messageTs: "170",
      prompt: "test",
      request: "change files",
      keyword: "change",
    });

    expect(result.outcome).toBe("refusal");
    if (result.outcome !== "refusal") throw new Error("expected refusal");

    expect(result.reason).toBe("policy");
    expect(result.responseText).toContain("Reason: write-policy-not-allowed");
    expect(result.responseText).toContain("Retry command: change: change files");
  });

  test("returns unsupported-repo refusal with retry command", async () => {
    const runner = createSlackWriteRunner({
      resolveRepoInstallationContext: async () => null,
      createWorkspace: async () => ({
        dir: "/tmp/slack-write-runner",
        cleanup: async () => undefined,
      }),
      execute: async () => {
        throw new Error("should not execute");
      },
      createPullRequest: async () => ({ htmlUrl: "https://github.com/xbmc/xbmc/pull/1" }),
    });

    const result = await runner.run({
      owner: "kodiai",
      repo: "private-repo",
      channel: "C1",
      threadTs: "170",
      messageTs: "170",
      prompt: "test",
      request: "apply patch",
      keyword: "apply",
    });

    expect(result.outcome).toBe("refusal");
    if (result.outcome !== "refusal") throw new Error("expected refusal");

    expect(result.reason).toBe("unsupported_repo");
    expect(result.responseText).toContain("Repository kodiai/private-repo is not accessible");
    expect(result.responseText).toContain("Retry command: apply: apply patch");
  });
});
