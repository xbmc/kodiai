import { describe, it, expect, mock, beforeEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAddonCheckHandler,
  ADDON_CHECK_RUNNER_TIME_BUDGET_MS,
  upsertAddonCheckComment,
} from "./addon-check.ts";
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

type MockPullRequestFile = string | {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
};

function toMockPullRequestFile(file: MockPullRequestFile) {
  return typeof file === "string" ? { filename: file } : file;
}

function createMockOctokit(files: MockPullRequestFile[]) {
  return {
    rest: {
      pulls: {
        listFiles: mock(async () => ({
          data: files.map(toMockPullRequestFile),
        })),
      },
    },
  };
}

type MockComment = { id: number; body: string };

function createMockOctokitWithIssues(files: MockPullRequestFile[], existingComments: MockComment[] = []) {
  const listCommentsMock = mock(async () => ({ data: existingComments }));
  const createCommentMock = mock(async () => ({ data: { id: 9999 } }));
  const updateCommentMock = mock(async () => ({ data: { id: existingComments[0]?.id ?? 1 } }));
  return {
    rest: {
      pulls: {
        listFiles: mock(async () => ({
          data: files.map(toMockPullRequestFile),
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

function createMockGithubApp(files: MockPullRequestFile[]): {
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
  files: MockPullRequestFile[],
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

function createAddonCheckHandlerForTest(
  deps: Parameters<typeof createAddonCheckHandler>[0],
): void {
  createAddonCheckHandler({
    __loadAddonRuleSourceForTests: async () => ({
      kind: "fallback",
      url: "https://kodi.wiki/view/Add-on_rules",
      text: "test addon rules",
    }),
    __runAddonRuleLlmForTests: async () => ({ findings: [] }),
    ...deps,
  });
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

async function createAddonRuleWorkspace(files: Record<string, string>): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-addon-check-test-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
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

function makeCheckerSubprocessByAddon(outputs: Record<string, string | "__TIMEOUT__" | "__TOOL_NOT_FOUND__">) {
  return mock(async (p: { addonDir: string; branch: string }) => {
    const addonId = p.addonDir.split("/").pop() ?? p.addonDir;
    const output = outputs[addonId] ?? "";
    if (output === "__TIMEOUT__") {
      return await new Promise<never>(() => {});
    }
    if (output === "__TOOL_NOT_FOUND__") {
      const err = new Error("not found") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return {
      exitCode: output.includes("ERROR:") || output.includes("WARN:") ? 1 : 0,
      stdout: output,
    };
  });
}

function findClassificationLog(infoCalls: InfoCall[]) {
  return infoCalls.find((c) => c.message === "addon-check: classification");
}

function makePrEvent(
  repoFullName: string,
  prNumber: number = 42,
  opts: { baseBranch?: string; headBranch?: string; action?: string } = {},
): WebhookEvent {
  const [owner = "xbmc", repoName = "repo-plugins"] = repoFullName.split("/");
  const baseBranch = opts.baseBranch ?? "omega";
  const headBranch = opts.headBranch ?? "feature/my-addon";
  return {
    id: "delivery-pr-1",
    name: "pull_request",
    installationId: 99,
    payload: {
      action: opts.action ?? "opened",
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

function makeAddonRuleReviewEvent(deliveryId: string): WebhookEvent {
  const event = makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "nexus" });
  return {
    ...event,
    id: deliveryId,
    name: "addon_rule_review",
    payload: { ...event.payload, action: "requested" },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("createAddonCheckHandler", () => {
  let router: ReturnType<typeof createMockEventRouter>;

  beforeEach(() => {
    router = createMockEventRouter();
  });

  it("creates addon-check comment and returns created Result status", async () => {
    const octokit = createMockOctokitWithIssues([], []);

    const result = await upsertAddonCheckComment({
      octokit: octokit as Parameters<typeof upsertAddonCheckComment>[0]["octokit"],
      owner: "xbmc",
      repo: "repo-plugins",
      prNumber: 42,
      marker: buildAddonCheckMarker("xbmc", "repo-plugins", 42),
      body: "addon check for @claude",
      botHandles: ["kodiai", "claude"],
    });

    expect(result).toEqual({
      ok: true,
      value: { action: "created", commentId: 9999 },
    });
    expect(octokit._createCommentMock).toHaveBeenCalledTimes(1);
    expect(octokit._updateCommentMock).not.toHaveBeenCalled();
  });

  it("updates addon-check comment and returns updated Result status", async () => {
    const marker = buildAddonCheckMarker("xbmc", "repo-plugins", 42);
    const octokit = createMockOctokitWithIssues([], [{ id: 777, body: `${marker}\nold body` }]);

    const result = await upsertAddonCheckComment({
      octokit: octokit as Parameters<typeof upsertAddonCheckComment>[0]["octokit"],
      owner: "xbmc",
      repo: "repo-plugins",
      prNumber: 42,
      marker,
      body: "updated addon check",
      botHandles: ["kodiai", "claude"],
    });

    expect(result).toEqual({
      ok: true,
      value: { action: "updated", commentId: 777 },
    });
    expect(octokit._updateCommentMock).toHaveBeenCalledTimes(1);
    expect(octokit._createCommentMock).not.toHaveBeenCalled();
  });

  it("returns err Result when addon-check comment publication fails", async () => {
    const failure = new Error("create failed");
    const octokit = createMockOctokitWithIssues([], []);
    octokit.rest.issues.createComment = mock(async () => {
      throw failure;
    }) as any;

    const result = await upsertAddonCheckComment({
      octokit: octokit as Parameters<typeof upsertAddonCheckComment>[0]["octokit"],
      owner: "xbmc",
      repo: "repo-plugins",
      prNumber: 42,
      marker: buildAddonCheckMarker("xbmc", "repo-plugins", 42),
      body: "addon check",
      botHandles: ["kodiai", "claude"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err).toBe(failure);
    }
  });

  it("updates the response for a replayed explicit-review delivery", async () => {
    const marker = "<!-- kodiai:addon-review-request:delivery-mention-1:addon-rule-review -->";
    const octokit = createMockOctokitWithIssues([], [{ id: 778, body: `${marker}\nold response` }]);

    const result = await upsertAddonCheckComment({
      octokit: octokit as Parameters<typeof upsertAddonCheckComment>[0]["octokit"],
      owner: "xbmc",
      repo: "repo-plugins",
      prNumber: 42,
      marker,
      body: `${marker}\nnew response`,
      botHandles: ["kodiai", "claude"],
    });

    expect(result).toEqual({
      ok: true,
      value: { action: "updated", commentId: 778 },
    });
    expect(octokit._updateCommentMock).toHaveBeenCalledTimes(1);
    expect(octokit._createCommentMock).not.toHaveBeenCalled();
  });

  // ── Registration ──────────────────────────────────────────────────────

  it("registers on pull_request.opened, pull_request.synchronize, and addon_rule_review.requested", () => {
    const { app } = createMockGithubApp([]);
    const { logger } = createMockLogger();
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
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
    expect(keys).toContain("addon_rule_review.requested");
    expect(router.captured).toHaveLength(3);
  });

  // ── Repo gate ─────────────────────────────────────────────────────────

  it("non-addon repo returns without calling listFiles", async () => {
    const { app, octokit } = createMockGithubApp([]);
    const { logger } = createMockLogger();
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
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

  it("publishes an invalid target branch finding instead of silently skipping", async () => {
    const files = [{
      filename: "plugin.video.foo/addon.xml",
      status: "modified",
      patch: "@@ -1 +1 @@\n-<addon version=\"1.0.0\"/>\n+<addon version=\"2.0.0\"/>",
    }];
    const { app, octokit } = createMockGithubAppWithIssues(files);
    const { logger } = createMockLogger();
    const { manager } = createMockWorkspaceManager();
    const { queue, enqueueArgs } = createMockJobQueue();

    createAddonCheckHandlerForTest({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runAddonRuleLlmForTests: async () => ({
        summary: "plugin.video.foo updates its manifest on main.",
        findings: [],
      }),
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "main" }),
    );

    expect(enqueueArgs).toHaveLength(1);
    expect(octokit._createCommentMock).toHaveBeenCalledTimes(1);
    const commentBody = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    expect(commentBody).toContain("## Kodiai Add-on Review");
    expect(commentBody).toContain('Target branch "main" is not an allowed Kodi add-on submission branch');
    expect(commentBody).toContain("Needs human review: 1 error and 0 warnings found.");
  });

  // ── Workspace creation with head branch ──────────────────────────────

  it("workspace.create called with head branch on non-fork PR", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app } = createMockGithubApp(files);
    const { logger } = createMockLogger();
    const subprocess = makeCheckerSubprocess("INFO: looks good\n");
    const { manager, createSpy } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
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

    createAddonCheckHandlerForTest({
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

  it("uses paginated PR file listing so addons after the first 100 files are checked", async () => {
    const firstPageFiles = Array.from(
      { length: 100 },
      (_, index) => ({ filename: `file-${index}.md` }),
    );
    const listFiles = mock(async ({ page }: { page?: number }) => {
      if (page === 1) {
        return {
          data: firstPageFiles,
          headers: {
            link: '<https://api.github.test/repos/xbmc/repo-plugins/pulls/42/files?page=2>; rel="last"',
          },
        };
      }
      return {
        data: [{ filename: "plugin.video.page-two/addon.xml" }],
        headers: {},
      };
    });
    const app = {
      getInstallationOctokit: async () => ({ rest: { pulls: { listFiles } } }) as any,
      getAppSlug: () => "kodiai",
      initialize: async () => {},
      checkConnectivity: async () => true,
      getInstallationToken: async () => "token",
      getRepoInstallationContext: async () => null,
    } as unknown as GitHubApp;
    const subprocess = mock(async () => ({ exitCode: 0, stdout: "" }));
    const { logger } = createMockLogger();
    const { workspace } = createMockWorkspace("/tmp/ws");
    const { manager } = createMockWorkspaceManager(workspace);
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
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

    expect(listFiles).toHaveBeenCalledTimes(2);
    expect(subprocess).toHaveBeenCalledTimes(1);
    expect((subprocess as any).mock.calls[0][0].addonDir).toBe("/tmp/ws/plugin.video.page-two");
  });

  // ── Findings logged with structured bindings ──────────────────────────

  it("findings logged at debug with production-safe severity bindings", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app } = createMockGithubApp(files);
    const { logger, infoCalls, debugCalls } = createMockLogger();
    const subprocess = makeCheckerSubprocess("ERROR: missing changelog\nWARN: old icon\n");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
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

    const findingLogs = debugCalls.filter((c) => c.message === "addon-check: finding detail");
    expect(findingLogs.length).toBe(2);
    expect(findingLogs[0]!.bindings.severity).toBe("severe");
    expect(findingLogs[0]!.bindings.findingLevel).toBeUndefined();
    expect(findingLogs[0]!.bindings.addonId).toBeUndefined();
    expect(findingLogs[0]!.bindings.message).toBe("missing changelog");
    expect(findingLogs[1]!.bindings.severity).toBe("advisory");
    expect(JSON.stringify(findingLogs[0]!.bindings).toLowerCase()).not.toContain("error");
    expect(JSON.stringify(findingLogs[1]!.bindings).toLowerCase()).not.toContain("warn");
    expect(infoCalls.some((c) => c.message === "addon-check: finding")).toBe(false);
  });

  // ── Summary log ───────────────────────────────────────────────────────

  it("logs summary with addonIds and totalFindings on completion", async () => {
    const files = ["plugin.video.foo/addon.xml", "plugin.audio.bar/addon.xml"];
    const { app } = createMockGithubApp(files);
    const { logger, infoCalls } = createMockLogger();
    const subprocess = makeCheckerSubprocess("ERROR: missing changelog\n");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
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

  it("uses an expanded checker budget so production addon checks have more headroom", () => {
    expect(ADDON_CHECK_RUNNER_TIME_BUDGET_MS).toBeGreaterThanOrEqual(240_000);
  });

  it("emits bounded all-timeout classification and avoids a misleading clean comment", async () => {
    const files = ["plugin.video.foo/addon.xml", "plugin.audio.bar/addon.xml"];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger, infoCalls, warnCalls } = createMockLogger();
    const subprocess = makeCheckerSubprocessByAddon({
      "plugin.audio.bar": "__TIMEOUT__",
      "plugin.video.foo": "__TIMEOUT__",
    });
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
      __addonCheckTimeBudgetMsForTests: 1,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega" }),
    );

    const rawTimeoutWarning = warnCalls.find((c) => c.message === "addon-check: runner timed out");
    expect(rawTimeoutWarning).toBeUndefined();

    const budgetSkipLogs = infoCalls.filter((c) => c.message === "addon-check: runner skipped after budget");
    expect(budgetSkipLogs).toHaveLength(2);
    expect(budgetSkipLogs.every((c) => c.bindings.timeBudgetMs === 1)).toBe(true);
    expect(budgetSkipLogs.every((c) => c.bindings.addonId === undefined)).toBe(true);

    const gateLog = findClassificationLog(infoCalls);
    expect(gateLog).toBeDefined();
    expect(gateLog!.bindings).toMatchObject({
      gate: "addon-check-classification",
      gateResult: "actionable-diagnostic",
      mode: "all-budget-exhausted",
      addonCount: 2,
      completedCount: 0,
      boundedIncompleteCount: 2,
      toolNotFoundCount: 0,
      findingCount: 0,
      budgetMs: 1,
      deliveryId: "delivery-pr-1",
      repo: "xbmc/repo-plugins",
      prNumber: 42,
    });
    expect(gateLog!.bindings.reasonCodes).toContain("all-budget-exhausted");
    expect(gateLog!.bindings.redaction).toMatchObject({
      rawCheckerOutputOmitted: true,
      workspacePathsOmitted: true,
      githubPayloadOmitted: true,
      addonIdentifiersOmitted: true,
    });
    expect(JSON.stringify(gateLog!.bindings)).not.toContain("plugin.video.foo");
    expect(JSON.stringify(gateLog!.bindings)).not.toContain("/tmp/test-workspace");
    const serializedGate = JSON.stringify(gateLog!.bindings).toLowerCase();
    expect(serializedGate).not.toContain("error");
    expect(serializedGate).not.toContain("failed");
    expect(serializedGate).not.toContain("warn");
    expect(serializedGate).not.toContain("timeout");

    expect(octokit._createCommentMock).toHaveBeenCalledTimes(1);
    const commentBody = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    expect(commentBody).toContain("⚠️ Review incomplete: kodi-addon-checker timed out before checking every changed addon");
    expect(commentBody).not.toContain("Mode:");
    expect(commentBody).not.toContain("Reason codes:");
    expect(commentBody).not.toContain("✅ No issues found");
  });

  it("distinguishes partial timeout with findings from clean completion", async () => {
    const files = ["plugin.video.foo/addon.xml", "plugin.audio.bar/addon.xml"];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger, infoCalls } = createMockLogger();
    const subprocess = makeCheckerSubprocessByAddon({
      "plugin.audio.bar": "__TIMEOUT__",
      "plugin.video.foo": "ERROR: addon.xml missing changelog\nWARN: addon.xml references an old icon\n",
    });
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
      __addonCheckTimeBudgetMsForTests: 1,
    });

    await router.captured[0]!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { baseBranch: "omega" }),
    );

    const gateLog = findClassificationLog(infoCalls);
    expect(gateLog).toBeDefined();
    expect(gateLog!.bindings).toMatchObject({
      gate: "addon-check-classification",
      gateResult: "actionable-diagnostic",
      mode: "partial-budget-exhausted",
      addonCount: 2,
      completedCount: 1,
      boundedIncompleteCount: 1,
      findingCount: 2,
      severeFindingCount: 1,
      advisoryFindingCount: 1,
    });
    expect(gateLog!.bindings.reasonCodes).toContain("partial-budget-exhausted");
    expect(gateLog!.bindings.reasonCodes).toContain("findings-present");
    expect(gateLog!.bindings.mode).not.toBe("completed-clean");
    const serializedGate = JSON.stringify(gateLog!.bindings).toLowerCase();
    expect(serializedGate).not.toContain("error");
    expect(serializedGate).not.toContain("failed");
    expect(serializedGate).not.toContain("warn");
    expect(serializedGate).not.toContain("timeout");

    expect(octokit._createCommentMock).toHaveBeenCalledTimes(1);
    const commentBody = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    expect(commentBody).toContain("Review incomplete: kodi-addon-checker timed out");
    expect(commentBody).toContain("missing changelog");
    expect(commentBody).not.toContain("Mode:");
  });

  it("emits tool-unavailable classification and still posts addon-rule review", async () => {
    const files = ["plugin.video.foo/addon.xml", "plugin.audio.bar/addon.xml"];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger, infoCalls } = createMockLogger();
    const subprocess = makeCheckerSubprocessByAddon({
      "plugin.audio.bar": "__TOOL_NOT_FOUND__",
      "plugin.video.foo": "__TOOL_NOT_FOUND__",
    });
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
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

    const gateLog = findClassificationLog(infoCalls);
    expect(gateLog).toBeDefined();
    expect(gateLog!.bindings).toMatchObject({
      gate: "addon-check-classification",
      gateResult: "expected-bounded-outcome",
      mode: "tool-unavailable",
      addonCount: 2,
      completedCount: 0,
      boundedIncompleteCount: 0,
      toolNotFoundCount: 2,
      findingCount: 0,
    });
    expect(gateLog!.bindings.reasonCodes).toContain("tool-unavailable");
    expect(octokit._createCommentMock).toHaveBeenCalledTimes(1);
    expect(octokit._updateCommentMock).not.toHaveBeenCalled();
    const commentBody = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    expect(commentBody).toContain("## Kodiai Add-on Review");
    expect(commentBody).toContain("kodi-addon-checker was unavailable");
  });

  it("emits completed-clean classification for clean runs without raw workspace leakage in the gate", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger, infoCalls } = createMockLogger();
    const subprocess = makeCheckerSubprocessByAddon({
      "plugin.video.foo": "BEGIN CHECKER /tmp/test-workspace raw detail that must stay out of the classification gate\n",
    });
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
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

    const gateLog = findClassificationLog(infoCalls);
    expect(gateLog).toBeDefined();
    expect(gateLog!.bindings).toMatchObject({
      gate: "addon-check-classification",
      gateResult: "expected-bounded-outcome",
      mode: "completed-clean",
      addonCount: 1,
      completedCount: 1,
      boundedIncompleteCount: 0,
      toolNotFoundCount: 0,
      findingCount: 0,
    });
    expect(gateLog!.bindings.reasonCodes).toContain("completed-clean");
    const serializedGate = JSON.stringify(gateLog!.bindings);
    expect(serializedGate).not.toContain("/tmp/test-workspace");
    expect(serializedGate).not.toContain("raw detail");
    expect(serializedGate).not.toContain("plugin.video.foo");
    expect(serializedGate.toLowerCase()).not.toContain("error");
    expect(serializedGate.toLowerCase()).not.toContain("failed");
    expect(serializedGate.toLowerCase()).not.toContain("warn");
    expect(serializedGate.toLowerCase()).not.toContain("timeout");

    expect(octokit._createCommentMock).toHaveBeenCalledTimes(1);
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

    createAddonCheckHandlerForTest({
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

    createAddonCheckHandlerForTest({
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

    createAddonCheckHandlerForTest({
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

    createAddonCheckHandlerForTest({
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

  it("creates a structured response after an explicit request without overwriting the canonical comment", async () => {
    const files = [{
      filename: "plugin.video.foo/default.py",
      status: "modified",
      patch: "@@ -1 +1 @@\n-old()\n+new()",
    }];
    const canonicalMarker = buildAddonCheckMarker("xbmc", "repo-plugins", 42);
    const deliveryId = "delivery-mention-1:addon-rule-review";
    const responseMarker = `<!-- kodiai:addon-review-request:${deliveryId} -->`;
    const { app, octokit } = createMockGithubAppWithIssues(files, [{
      id: 777,
      body: `${canonicalMarker}\nold automatic review`,
    }]);
    const { logger } = createMockLogger();
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: makeCheckerSubprocess(""),
      __runAddonRuleLlmForTests: async () => ({
        summary: "plugin.video.foo changes one Python line on nexus.",
        findings: [],
      }),
    });

    await router.captured.find((entry) => entry.key === "addon_rule_review.requested")!.handler(
      makeAddonRuleReviewEvent(deliveryId),
    );

    expect(octokit._createCommentMock).toHaveBeenCalledTimes(1);
    expect(octokit._updateCommentMock).not.toHaveBeenCalled();
    const body = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    expect(body).toContain(responseMarker);
    expect(body).not.toContain(canonicalMarker);
    expect(body).toContain("### Summary");
    expect(body).toContain("### Findings");
    expect(body).toContain("### Verdict");
  });

  it("creates separate responses for distinct explicit-review deliveries", async () => {
    const files = [{
      filename: "plugin.video.foo/default.py",
      status: "modified",
      patch: "@@ -1 +1 @@\n-old()\n+new()",
    }];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger } = createMockLogger();
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: makeCheckerSubprocess(""),
    });

    const handler = router.captured.find((entry) => entry.key === "addon_rule_review.requested")!.handler;
    await handler(makeAddonRuleReviewEvent("delivery-mention-1:addon-rule-review"));
    await handler(makeAddonRuleReviewEvent("delivery-mention-2:addon-rule-review"));

    expect(octokit._createCommentMock).toHaveBeenCalledTimes(2);
    const firstBody = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    const secondBody = (octokit._createCommentMock as any).mock.calls[1][0].body as string;
    expect(firstBody).toContain("<!-- kodiai:addon-review-request:delivery-mention-1:addon-rule-review -->");
    expect(secondBody).toContain("<!-- kodiai:addon-review-request:delivery-mention-2:addon-rule-review -->");
    expect(firstBody).not.toBe(secondBody);
  });

  it("posts comment when findings exist", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger } = createMockLogger();
    // Subprocess returns one ERROR finding
    const subprocess = makeCheckerSubprocess("ERROR: addon.xml missing changelog\n");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
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

  it("strips bot mentions from addon check findings before publishing", async () => {
    const files = ["plugin.video.foo/addon.xml"];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger } = createMockLogger();
    const subprocess = makeCheckerSubprocess("ERROR: addon.xml says @claude should inspect this addon\n");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
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
    const commentBody = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    expect(commentBody).not.toContain("@claude");
    expect(commentBody).toContain("claude should inspect this addon");
  });

  it("posts addon-rule review when no checker findings and tool not found", async () => {
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

    createAddonCheckHandlerForTest({
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
    const commentBody = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    expect(commentBody).toContain("## Kodiai Add-on Review");
    expect(commentBody).toContain("kodi-addon-checker was unavailable");
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

    createAddonCheckHandlerForTest({
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

    createAddonCheckHandlerForTest({
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

  it("opened PR review passes patches only and publishes concise structured output", async () => {
    const files = [{
      filename: "plugin.video.foo/default.py",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: "@@ -1 +1 @@\n-old()\n+new()",
    }];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger } = createMockLogger();
    const subprocess = makeCheckerSubprocess("");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();
    let capturedInput: Parameters<NonNullable<Parameters<typeof createAddonCheckHandler>[0]["__runAddonRuleLlmForTests"]>>[0] | undefined;
    const llmReview = mock(async (input: NonNullable<typeof capturedInput>) => {
      capturedInput = input;
      return {
        summary: "plugin.video.foo updates one Python patch on nexus.",
        findings: [{
        addonId: "plugin.video.foo",
        path: "plugin.video.foo/default.py",
        rule: "download-consent",
        level: "WARN" as const,
        source: "llm" as const,
        message: "Download appears to happen without user confirmation.",
        }],
      };
    });

    createAddonCheckHandlerForTest({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
      __loadAddonRuleSourceForTests: async () => ({
        kind: "wiki",
        url: "https://kodi.wiki/view/Add-on_rules",
        text: "No analytics.",
      }),
      __runAddonRuleLlmForTests: llmReview,
    });

    await router.captured[0]!.handler(makePrEvent("xbmc/repo-plugins"));

    expect(llmReview).toHaveBeenCalledTimes(1);
    expect(capturedInput?.contexts[0]?.files[0]).toMatchObject({
      path: "plugin.video.foo/default.py",
      patch: "@@ -1 +1 @@\n-old()\n+new()",
    });
    expect(capturedInput?.contexts[0]?.files[0]).not.toHaveProperty("content");
    expect(capturedInput).not.toHaveProperty("workspaceDir");
    expect(octokit._createCommentMock).toHaveBeenCalledTimes(1);
    const commentBody = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    expect(commentBody).toContain("## Kodiai Add-on Review");
    expect(commentBody).toContain("### Summary");
    expect(commentBody).toContain("### Findings");
    expect(commentBody).toContain("### Verdict");
    expect(commentBody).toContain("Download appears to happen without user confirmation.");
  });

  it("synchronize events do not run addon-rule LLM review automatically", async () => {
    const files = [{
      filename: "plugin.video.foo/addon.xml",
      status: "modified",
      patch: "@@ -1 +1 @@\n-<addon version=\"1.0.0\"/>\n+<addon version=\"1.0.1\"/>",
    }];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger } = createMockLogger();
    const subprocess = makeCheckerSubprocess("ERROR: addon.xml checker finding\n");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();
    const llmReview = mock(async () => ({
      summary: "Should not appear.",
      findings: [{
        addonId: "plugin.video.foo",
        path: "plugin.video.foo/addon.xml",
        rule: "test",
        level: "WARN" as const,
        source: "llm" as const,
        message: "Should not appear.",
      }],
    }));

    createAddonCheckHandlerForTest({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
      __runAddonRuleLlmForTests: llmReview,
    });

    await router.captured.find((entry) => entry.key === "pull_request.synchronize")!.handler(
      makePrEvent("xbmc/repo-plugins", 42, { action: "synchronize" }),
    );

    expect(llmReview).not.toHaveBeenCalled();
    const commentBody = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    expect(commentBody).toContain("checker finding");
    expect(commentBody).toContain("## Kodiai Add-on Review");
    expect(commentBody).toContain("Reviewed 1 changed addon on `omega` using 1 scoped patch.");
    expect(commentBody).not.toContain("Should not appear.");
  });

  it("opened PRs with only path-level addon-rule context skip LLM review", async () => {
    const files = ["plugin.video.foo/resources/settings.xml"];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger } = createMockLogger();
    const subprocess = makeCheckerSubprocess("");
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();
    const llmReview = mock(async () => ({
      summary: "Should not be generated.",
      findings: [{
        addonId: "plugin.video.foo",
        rule: "test",
        level: "WARN" as const,
        source: "llm" as const,
        message: "Should not be generated.",
      }],
    }));

    createAddonCheckHandlerForTest({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
      __runAddonRuleLlmForTests: llmReview,
    });

    await router.captured[0]!.handler(makePrEvent("xbmc/repo-plugins"));

    expect(llmReview).not.toHaveBeenCalled();
    const commentBody = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    expect(commentBody).toContain("## Kodiai Add-on Review");
    expect(commentBody).not.toContain("Should not be generated.");
  });

  it("posts addon-rule review even when kodi-addon-checker is unavailable", async () => {
    const files = [{
      filename: "plugin.video.foo/default.py",
      status: "modified",
      patch: "@@ -1 +1 @@\n-old()\n+track_usage()",
    }];
    const { app, octokit } = createMockGithubAppWithIssues(files, []);
    const { logger } = createMockLogger();
    const subprocess = makeCheckerSubprocessByAddon({ "plugin.video.foo": "__TOOL_NOT_FOUND__" });
    const { manager } = createMockWorkspaceManager();
    const { queue } = createMockJobQueue();

    createAddonCheckHandlerForTest({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
      workspaceManager: manager,
      jobQueue: queue,
      __runSubprocessForTests: subprocess,
      __loadAddonRuleSourceForTests: async () => ({
        kind: "fallback",
        url: "https://kodi.wiki/view/Add-on_rules",
        text: "Fallback rules.",
      }),
      __runAddonRuleLlmForTests: async () => ({
        summary: "plugin.video.foo adds usage tracking on omega.",
        findings: [{
          addonId: "plugin.video.foo",
          path: "plugin.video.foo/default.py",
          rule: "usage-analytics",
          level: "ERROR",
          source: "llm",
          message: "Uses analytics.",
        }],
      }),
    });

    await router.captured[0]!.handler(makePrEvent("xbmc/repo-plugins"));

    expect(octokit._createCommentMock).toHaveBeenCalledTimes(1);
    const commentBody = (octokit._createCommentMock as any).mock.calls[0][0].body as string;
    expect(commentBody).toContain("Review incomplete: kodi-addon-checker was unavailable and the live rules were unavailable");
    expect(commentBody).toContain("Uses analytics.");
  });
});
