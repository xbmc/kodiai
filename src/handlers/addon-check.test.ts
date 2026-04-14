import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createAddonCheckHandler } from "./addon-check.ts";
import { buildAddonCheckMarker } from "../lib/addon-check-formatter.ts";
import type { EventRouter, WebhookEvent, EventHandler } from "../webhook/types.ts";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { AppConfig } from "../config.ts";
import type { WorkspaceManager, JobQueue, JobQueueRunMetadata, Workspace } from "../jobs/types.ts";
import { createQueueRunMetadata, getEmptyActiveJobs } from "../jobs/queue.test-helpers.ts";

// ── Test helpers ──────────────────────────────────────────────────────────

type InfoCall = { bindings: Record<string, unknown>; message: string };
type WarnCall = { bindings: Record<string, unknown>; message: string };

function createMockLogger() {
  const infoCalls: InfoCall[] = [];
  const debugCalls: InfoCall[] = [];
  const warnCalls: WarnCall[] = [];
  const logger = {
    warn: (bindings: Record<string, unknown>, message: string) => {
      warnCalls.push({ bindings, message });
    },
    info: (bindings: Record<string, unknown>, message: string) => {
      infoCalls.push({ bindings, message });
    },
    debug: (bindings: Record<string, unknown>, message: string) => {
      debugCalls.push({ bindings, message });
    },
    error: () => {},
    child: () => {
      // Child logger writes to same arrays by default — tests can override
      return createMockLoggerWithArrays(infoCalls, debugCalls, warnCalls);
    },
    _infoCalls: infoCalls,
    _debugCalls: debugCalls,
    _warnCalls: warnCalls,
  };
  return { logger: logger as unknown as Logger, infoCalls, debugCalls, warnCalls };
}

function createMockLoggerWithArrays(
  infoCalls: InfoCall[],
  debugCalls: InfoCall[],
  warnCalls: WarnCall[],
) {
  const logger = {
    warn: (bindings: Record<string, unknown>, message: string) => {
      warnCalls.push({ bindings, message });
    },
    info: (bindings: Record<string, unknown>, message: string) => {
      infoCalls.push({ bindings, message });
    },
    debug: (bindings: Record<string, unknown>, message: string) => {
      debugCalls.push({ bindings, message });
    },
    error: () => {},
    child: () => createMockLoggerWithArrays(infoCalls, debugCalls, warnCalls),
  };
  return logger as unknown as Logger;
}


type CapturedRegistration = { key: string; handler: EventHandler };

function createMockEventRouter(): EventRouter & { captured: CapturedRegistration[] } {
  const captured: CapturedRegistration[] = [];
  return {
    captured,
    register(eventKey: string, handler: EventHandler) {
      captured.push({ key: eventKey, handler });
    },
    dispatch: async () => {},
  };
}

function createMockOctokit(files: string[]) {
  return {
    rest: {
      pulls: {
        listFiles: mock(async () => ({
          data: files.map((filename) => ({ filename })),
        })),
      },
    },
  };
}

type MockComment = { id: number; body: string };

function createMockOctokitWithIssues(files: string[], existingComments: MockComment[] = []) {
  const listCommentsMock = mock(async () => ({ data: existingComments }));
  const createCommentMock = mock(async () => ({ data: { id: 9999 } }));
  const updateCommentMock = mock(async () => ({ data: { id: existingComments[0]?.id ?? 1 } }));
  return {
    rest: {
      pulls: {
        listFiles: mock(async () => ({
          data: files.map((filename) => ({ filename })),
        })),
      },
      issues: {
        listComments: listCommentsMock,
        createComment: createCommentMock,
        updateComment: updateCommentMock,
      },
    },
    _listCommentsMock: listCommentsMock,
    _createCommentMock: createCommentMock,
    _updateCommentMock: updateCommentMock,
  };
}

function createMockGithubApp(files: string[]): {
  app: GitHubApp;
  octokit: ReturnType<typeof createMockOctokit>;
} {
  const octokit = createMockOctokit(files);
  const app = {
    getInstallationOctokit: async () => octokit as any,
    getAppSlug: () => "kodiai",
    initialize: async () => {},
    checkConnectivity: async () => true,
    getInstallationToken: async () => "token",
    getRepoInstallationContext: async () => null,
  } as unknown as GitHubApp;
  return { app, octokit };
}

function createMockGithubAppWithIssues(
  files: string[],
  existingComments: MockComment[] = [],
): {
  app: GitHubApp;
  octokit: ReturnType<typeof createMockOctokitWithIssues>;
} {
  const octokit = createMockOctokitWithIssues(files, existingComments);
  const app = {
    getInstallationOctokit: async () => octokit as any,
    getAppSlug: () => "kodiai",
    initialize: async () => {},
    checkConnectivity: async () => true,
    getInstallationToken: async () => "token",
    getRepoInstallationContext: async () => null,
  } as unknown as GitHubApp;
  return { app, octokit };
}

function makePartialConfig(addonRepos: string[]): AppConfig {
  return { addonRepos } as unknown as AppConfig;
}

/** Returns a no-op workspace stub with a capturable cleanup spy. */
function createMockWorkspace(dir = "/tmp/test-workspace"): {
  workspace: Workspace;
  cleanupCalled: () => boolean;
} {
  let cleaned = false;
  const workspace: Workspace = {
    dir,
    cleanup: async () => { cleaned = true; },
  };
  return { workspace, cleanupCalled: () => cleaned };
}

function createMockWorkspaceManager(workspaceOverride?: Workspace): {
  manager: WorkspaceManager;
  createSpy: ReturnType<typeof mock>;
  workspace: Workspace;
  cleanupCalled: () => boolean;
} {
  const { workspace, cleanupCalled } = createMockWorkspace();
  const effectiveWorkspace = workspaceOverride ?? workspace;
  const createSpy = mock(async () => effectiveWorkspace);
  const manager: WorkspaceManager = {
    create: createSpy as unknown as WorkspaceManager["create"],
    cleanupStale: async () => 0,
  };
  return { manager, createSpy, workspace: effectiveWorkspace, cleanupCalled };
}

function createMockJobQueue(): {
  queue: JobQueue;
  enqueueArgs: Array<{ installationId: number }>;
} {
  const enqueueArgs: Array<{ installationId: number }> = [];
  const queue: JobQueue = {
    enqueue: async (installationId, fn) => {
      enqueueArgs.push({ installationId });
      return fn(createQueueRunMetadata());
    },
    getQueueSize: () => 0,
    getPendingCount: () => 0,
    getActiveJobs: getEmptyActiveJobs,
  };
  return { queue, enqueueArgs };
}

/** Subprocess stub that returns checker output with one ERROR finding. */
function makeCheckerSubprocess(output: string) {
  return mock(async (_p: { addonDir: string; branch: string }) => ({
    exitCode: 1,
    stdout: output,
  }));
}

function makePrEvent(
  repoFullName: string,
  prNumber: number = 42,
  opts: { baseBranch?: string; headBranch?: string } = {},
): WebhookEvent {
  const [owner = "xbmc", repoName = "repo-plugins"] = repoFullName.split("/");
  const baseBranch = opts.baseBranch ?? "omega";
  const headBranch = opts.headBranch ?? "feature/my-addon";
  return {
    id: "delivery-pr-1",
    name: "pull_request",
    installationId: 99,
    payload: {
      action: "opened",
      pull_request: {
        number: prNumber,
        base: { ref: baseBranch },
        head: {
          ref: headBranch,
          repo: { full_name: `${owner}/${repoName}` },
        },
      },
      repository: {
        full_name: repoFullName,
        name: repoName,
        owner: { login: owner },
      },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("createAddonCheckHandler", () => {
  let router: ReturnType<typeof createMockEventRouter>;

  beforeEach(() => {
    router = createMockEventRouter();
  });

  // ── Registration ──────────────────────────────────────────────────────

  it("registers on pull_request.opened and pull_request.synchronize", () => {
    const { app } = createMockGithubApp([]);
    const { logger } = createMockLogger();
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
    });

    const keys = router.captured.map((c) => c.key);
    expect(keys).toContain("pull_request.opened");
    expect(keys).toContain("pull_request.synchronize");
    expect(router.captured).toHaveLength(2);
  });

  // ── Repo gate ─────────────────────────────────────────────────────────

  it("non-addon repo returns without calling listFiles", async () => {
    const { app, octokit } = createMockGithubApp([]);
    const { logger } = createMockLogger();
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
    });

    // Dispatch to xbmc/xbmc — not in addonRepos
    const event = makePrEvent("xbmc/xbmc");
    for (const { handler } of router.captured) {
      await handler(event);
    }

    expect(octokit.rest.pulls.listFiles).not.toHaveBeenCalled();
  });

  // ── Unknown kodi branch ───────────────────────────────────────────────

  it("unknown base branch warns and skips (does not enqueue)", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app } = createMockGithubApp(files);
    const { logger, warnCalls } = createMockLogger();
    const { manager } = createMockWorkspaceManager();
    const { queue, enqueueArgs } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "main" }),
    );

    // No enqueue
    expect(enqueueArgs).toHaveLength(0);
    // Warn emitted with baseBranch binding
    const warnEntry = warnCalls.find((c) => c.message === "addon-check: unknown kodi branch, skipping");
    expect(warnEntry).toBeDefined();
    expect(warnEntry!.bindings.baseBranch).toBe("main");
  });

  // ── Workspace creation with head branch ──────────────────────────────

  it("workspace.create called with head branch on non-fork PR", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app } = createMockGithubApp(files);
    const { logger } = createMockLogger();
    const subprocess = makeCheckerSubprocess("INFO: looks good\n");
    const { manager, createSpy } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega", headBranch: "feature/foo" }),
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    const createCall = (createSpy as any).mock.calls[0];
    expect(createCall[1]).toMatchObject({
      owner: "xbmc",
      repo: "repo-plugins",
      ref: "feature/foo",
    });
  });

  // ── Runner called per addon with correct args ─────────────────────────

  it("runner called per addon with correct addonDir and branch", async () => {
    const files = [
      "plugin.video.foo/addon.xml",
      "plugin.audio.bar/addon.xml",
    ];
    const { app } = createMockGithubApp(files);
    const { logger } = createMockLogger();
    const { workspace } = createMockWorkspace("/tmp/ws");
    const subprocess = mock(async (p: { addonDir: string; branch: string }) => ({
      exitCode: 0,
      stdout: "",
    }));
    const { manager } = createMockWorkspaceManager(workspace);
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "nexus" }),
    );

    expect(subprocess).toHaveBeenCalledTimes(2);
    const dirs = (subprocess as any).mock.calls.map((c: any) => c[0].addonDir as string);
    expect(dirs).toContain("/tmp/ws/plugin.audio.bar");
    expect(dirs).toContain("/tmp/ws/plugin.video.foo");
    const branches = (subprocess as any).mock.calls.map((c: any) => c[0].branch as string);
    expect(branches.every((b: string) => b === "nexus")).toBe(true);
  });

  // ── Findings logged with structured bindings ──────────────────────────

  it("findings logged with addonId, level, message bindings", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app } = createMockGithubApp(files);
    const { logger, infoCalls } = createMockLogger();
    const subprocess = makeCheckerSubprocess("ERROR: missing changelog\nWARN: old icon\n");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega" }),
    );

    const findingLogs = infoCalls.filter((c) => c.message === "addon-check: finding");
    expect(findingLogs.length).toBe(2);
    expect(findingLogs[0]!.bindings.level).toBe("ERROR");
    expect(findingLogs[0]!.bindings.message).toBe("missing changelog");
    expect(findingLogs[1]!.bindings.level).toBe("WARN");
    expect(findingLogs[1]!.bindings.message).toBe("old icon");
  });

  // ── Summary log ───────────────────────────────────────────────────────

  it("logs summary with addonIds and totalFindings on completion", async () => {
    const files = ["plugin.video.foo/addon.xml", "plugin.audio.bar/addon.xml"];
    const { app } = createMockGithubApp(files);
    const { logger, infoCalls } = createMockLogger();
    const subprocess = makeCheckerSubprocess("ERROR: missing changelog\n");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega" }),
    );

    const summary = infoCalls.find((c) => c.message === "addon-check: complete");
    expect(summary).toBeDefined();
    expect(summary!.bindings.addonIds).toEqual(["plugin.audio.bar", "plugin.video.foo"]);
    // 1 ERROR finding per addon × 2 addons
    expect(summary!.bindings.totalFindings).toBe(2);
  });

  // ── workspace.cleanup called in finally ───────────────────────────────

  it("workspace.cleanup called even when runner throws", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app } = createMockGithubApp(files);
    const { logger } = createMockLogger();
    const failingSubprocess = mock(async (_p: { addonDir: string; branch: string }) => {
      throw new Error("subprocess exploded");
    });
    let cleaned = false;
    const crashWorkspace: Workspace = {
      dir: "/tmp/crash-ws",
      cleanup: async () => { cleaned = true; },
    };
    const { manager } = createMockWorkspaceManager(crashWorkspace);
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: failingSubprocess,
    });

    // Should not throw — outer catch handles runner errors
    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega" }),
    );

    expect(cleaned).toBe(true);
  });

  // ── Existing scaffold tests (updated message) ─────────────────────────

  it("addon repo logs correct addon IDs (sorted, deduplicated)", async () => {
    const files = [
      "plugin.video.foo/addon.xml",
      "plugin.video.foo/icon.png",
      "plugin.audio.bar/addon.xml",
    ];
    const { app } = createMockGithubApp(files);
    const { logger, infoCalls } = createMockLogger();
    const subprocess = makeCheckerSubprocess("");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega" }),
    );

    expect(infoCalls.length).toBeGreaterThanOrEqual(1);
    const completionLog = infoCalls.find((c) => c.message === "addon-check: complete");
    expect(completionLog).toBeDefined();
    expect(completionLog!.bindings.addonIds).toEqual([
      "plugin.audio.bar",
      "plugin.video.foo",
    ]);
  });

  it("empty PR (no files) logs empty addon ID list", async () => {
    const { app } = createMockGithubApp([]);
    const { logger, infoCalls } = createMockLogger();
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega" }),
    );

    // Empty addon list → early return before enqueue, logs "addon-check: complete" with empty array
    const completionLog = infoCalls.find((c) => c.message === "addon-check: complete");
    expect(completionLog).toBeDefined();
    expect(completionLog!.bindings.addonIds).toEqual([]);
  });

  it("root-level files (no slash) are excluded from addon IDs", async () => {
    const files = ["README.md", "plugin.video.foo/addon.xml"];
    const { app } = createMockGithubApp(files);
    const { logger, infoCalls } = createMockLogger();
    const subprocess = makeCheckerSubprocess("");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega" }),
    );

    const completionLog = infoCalls.find((c) => c.message === "addon-check: complete");
    expect(completionLog).toBeDefined();
    // README.md has no slash → excluded. plugin.video.foo/addon.xml → "plugin.video.foo"
    expect(completionLog!.bindings.addonIds).toEqual(["plugin.video.foo"]);
  });

  // ── Comment upsert ────────────────────────────────────────────────────

  it("posts comment when findings exist", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger } = createMockLogger();
    // Subprocess returns one ERROR finding
    const subprocess = makeCheckerSubprocess("ERROR: missing changelog\n");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega" }),
    );

    expect(octokit._createCommentMock).toHaveBeenCalledTimes(1);
    expect(octokit._updateCommentMock).not.toHaveBeenCalled();

    const callArgs = (octokit._createCommentMock as any).mock.calls[0][0];
    const marker = buildAddonCheckMarker("xbmc", "repo-plugins", 42);
    expect(callArgs.body).toContain(marker);
    expect(callArgs.body).toContain("ERROR");
    expect(callArgs.body).toContain("missing changelog");
  });

  it("no comment posted when no findings and tool not found", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger } = createMockLogger();
    // Subprocess throws ENOENT — signals toolNotFound path in runAddonChecker
    const subprocess = mock(async (_p: { addonDir: string; branch: string }) => {
      const err = new Error("not found") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega" }),
    );

    expect(octokit._createCommentMock).not.toHaveBeenCalled();
    expect(octokit._updateCommentMock).not.toHaveBeenCalled();
  });

  it("updates existing comment on second push (upsert path)", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const marker = buildAddonCheckMarker("xbmc", "repo-plugins", 42);
    const existingComments: MockComment[] = [
      { id: 777, body: `${marker}\n## Kodiai Addon Check\n\n✅ No issues found.` },
    ];
    const { app, octokit } = createMockGithubAppWithIssues(files, existingComments);
    const { logger } = createMockLogger();
    const subprocess = makeCheckerSubprocess("ERROR: missing changelog\n");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega" }),
    );

    expect(octokit._updateCommentMock).toHaveBeenCalledTimes(1);
    expect(octokit._createCommentMock).not.toHaveBeenCalled();

    const updateArgs = (octokit._updateCommentMock as any).mock.calls[0][0];
    expect(updateArgs.comment_id).toBe(777);
    expect(updateArgs.body).toContain(marker);
  });

  it("fork PR uses base branch + fetchAndCheckoutPullRequestHeadRef", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger } = createMockLogger();
    const subprocess = makeCheckerSubprocess("");
    const { manager, createSpy } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    const fetchAndCheckoutCalls: Array<{ dir: string; prNumber: number; localBranch: string }> = [];
    const fetchAndCheckoutStub = mock(
      async (opts: { dir: string; prNumber: number; localBranch?: string }) => {
        fetchAndCheckoutCalls.push({
          dir: opts.dir,
          prNumber: opts.prNumber,
          localBranch: opts.localBranch ?? "pr-review",
        });
        return { localBranch: opts.localBranch ?? "pr-review" };
      },
    );

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
      __fetchAndCheckoutForTests: fetchAndCheckoutStub as any,
    });

    // Fork PR: head.repo.full_name differs from repository.full_name
    const event: WebhookEvent = {
      id: "delivery-fork-1",
      name: "pull_request",
      installationId: 99,
      payload: {
        action: "opened",
        pull_request: {
          number: 42,
          base: { ref: "omega" },
          head: {
            ref: "feature/my-fix",
            repo: { full_name: "contributor/repo-plugins" },  // fork
          },
        },
        repository: {
          full_name: "xbmc/repo-plugins",
          name: "repo-plugins",
          owner: { login: "xbmc" },
        },
      },
    };

    await router.captured[0]!.handler(event);

    // Workspace should be created with base branch, not head branch
    expect(createSpy).toHaveBeenCalledTimes(1);
    const createCall = (createSpy as any).mock.calls[0];
    expect(createCall[1]).toMatchObject({
      owner: "xbmc",
      repo: "repo-plugins",
      ref: "omega",  // base branch
    });

    // fetchAndCheckoutPullRequestHeadRef should be called
    expect(fetchAndCheckoutCalls).toHaveLength(1);
    expect(fetchAndCheckoutCalls[0]!.prNumber).toBe(42);
    expect(fetchAndCheckoutCalls[0]!.localBranch).toBe("pr-check");
  });
});
