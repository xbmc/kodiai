import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createAddonCheckHandler } from "./addon-check.ts";
import type { EventRouter, WebhookEvent, EventHandler } from "../webhook/types.ts";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { AppConfig } from "../config.ts";

// ── Test helpers ──────────────────────────────────────────────────────────

type InfoCall = { bindings: Record<string, unknown>; message: string };

function createMockLogger() {
  const infoCalls: InfoCall[] = [];
  const debugCalls: InfoCall[] = [];
  const logger = {
    warn: () => {},
    info: (bindings: Record<string, unknown>, message: string) => {
      infoCalls.push({ bindings, message });
    },
    debug: (bindings: Record<string, unknown>, message: string) => {
      debugCalls.push({ bindings, message });
    },
    error: () => {},
    child: () => createMockLogger().logger,
    _infoCalls: infoCalls,
    _debugCalls: debugCalls,
  };
  return { logger: logger as unknown as Logger, infoCalls, debugCalls };
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

function makePartialConfig(addonRepos: string[]): AppConfig {
  return { addonRepos } as unknown as AppConfig;
}

function makePrEvent(repoFullName: string, prNumber: number = 42): WebhookEvent {
  const [owner = "xbmc", repoName = "repo-plugins"] = repoFullName.split("/");
  return {
    id: "delivery-pr-1",
    name: "pull_request",
    installationId: 99,
    payload: {
      action: "opened",
      pull_request: { number: prNumber },
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

  it("registers on pull_request.opened and pull_request.synchronize", () => {
    const { app } = createMockGithubApp([]);
    const { logger } = createMockLogger();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
    });

    const keys = router.captured.map((c) => c.key);
    expect(keys).toContain("pull_request.opened");
    expect(keys).toContain("pull_request.synchronize");
    expect(router.captured).toHaveLength(2);
  });

  it("non-addon repo returns without calling listFiles", async () => {
    const { app, octokit } = createMockGithubApp([]);
    const { logger } = createMockLogger();

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
    });

    // Dispatch to xbmc/xbmc — not in addonRepos
    const event = makePrEvent("xbmc/xbmc");
    for (const { handler } of router.captured) {
      await handler(event);
    }

    expect(octokit.rest.pulls.listFiles).not.toHaveBeenCalled();
  });

  it("addon repo logs correct addon IDs (sorted, deduplicated)", async () => {
    const files = [
      "plugin.video.foo/addon.xml",
      "plugin.video.foo/icon.png",
      "plugin.audio.bar/addon.xml",
    ];
    const { app } = createMockGithubApp(files);
    const { logger, infoCalls } = createMockLogger();

    // Override child to return a logger that also writes to the same infoCalls array
    (logger as any).child = () => {
      const { logger: childLogger } = createMockLogger();
      (childLogger as any).info = (bindings: Record<string, unknown>, message: string) => {
        infoCalls.push({ bindings, message });
      };
      return childLogger;
    };

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
    });

    await router.captured[0]!.handler(makePrEvent("xbmc/repo-plugins"));

    expect(infoCalls.length).toBeGreaterThanOrEqual(1);
    const addonCheckCall = infoCalls.find((c) =>
      c.message === "Addon check: would check addons",
    );
    expect(addonCheckCall).toBeDefined();
    expect(addonCheckCall!.bindings.addonIds).toEqual([
      "plugin.audio.bar",
      "plugin.video.foo",
    ]);
  });

  it("empty PR (no files) logs empty addon ID list", async () => {
    const { app } = createMockGithubApp([]);
    const infoCalls: InfoCall[] = [];
    const { logger } = createMockLogger();

    (logger as any).child = () => {
      const { logger: childLogger } = createMockLogger();
      (childLogger as any).info = (bindings: Record<string, unknown>, message: string) => {
        infoCalls.push({ bindings, message });
      };
      return childLogger;
    };

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
    });

    await router.captured[0]!.handler(makePrEvent("xbmc/repo-plugins"));

    const addonCheckCall = infoCalls.find((c) =>
      c.message === "Addon check: would check addons",
    );
    expect(addonCheckCall).toBeDefined();
    expect(addonCheckCall!.bindings.addonIds).toEqual([]);
  });

  it("root-level files (no slash) are excluded from addon IDs", async () => {
    const files = ["README.md", "plugin.video.foo/addon.xml"];
    const { app } = createMockGithubApp(files);
    const infoCalls: InfoCall[] = [];
    const { logger } = createMockLogger();

    (logger as any).child = () => {
      const { logger: childLogger } = createMockLogger();
      (childLogger as any).info = (bindings: Record<string, unknown>, message: string) => {
        infoCalls.push({ bindings, message });
      };
      return childLogger;
    };

    createAddonCheckHandler({
      eventRouter: router,
      githubApp: app,
      config: makePartialConfig(["xbmc/repo-plugins"]),
      logger,
    });

    await router.captured[0]!.handler(makePrEvent("xbmc/repo-plugins"));

    const addonCheckCall = infoCalls.find((c) =>
      c.message === "Addon check: would check addons",
    );
    expect(addonCheckCall).toBeDefined();
    // README.md has no slash → excluded. plugin.video.foo/addon.xml → "plugin.video.foo"
    expect(addonCheckCall!.bindings.addonIds).toEqual(["plugin.video.foo"]);
  });
});
