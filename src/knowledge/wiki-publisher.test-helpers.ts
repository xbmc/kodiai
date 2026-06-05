import { mock } from "bun:test";
import type { Octokit } from "@octokit/rest";
import type { GitHubApp } from "../auth/github-app.ts";
import type { Sql } from "../db/client.ts";
import type { PagePostResult, PageSuggestionGroup } from "./wiki-publisher-types.ts";

export function makeGroup(overrides: Partial<PageSuggestionGroup> = {}): PageSuggestionGroup {
  return {
    pageId: 100,
    pageTitle: "Add-on development",
    suggestions: [
      {
        sectionHeading: "Getting Started",
        suggestion: "The add-on development process now uses the new build system.",
        whySummary: "Build system was replaced in PR #27901.",
        citingPrs: [{ prNumber: 27901, prTitle: "New build system" }],
        voiceMismatchWarning: false,
      },
    ],
    ...overrides,
  };
}

export function makePageResult(overrides: Partial<PagePostResult> = {}): PagePostResult {
  return {
    pageId: 100,
    pageTitle: "Add-on development",
    commentId: 12345,
    success: true,
    suggestionsCount: 2,
    prsCount: 1,
    hasVoiceWarnings: false,
    ...overrides,
  };
}

export function createMockOctokit() {
  return {
    rest: {
      issues: {
        create: mock(() =>
          Promise.resolve({
            data: { number: 42, html_url: "https://github.com/xbmc/wiki/issues/42" },
          }),
        ),
        get: mock(() =>
          Promise.resolve({
            data: { html_url: "https://github.com/xbmc/wiki/issues/42" },
          }),
        ),
        createComment: mock(() =>
          Promise.resolve({ data: { id: 99001 } }),
        ),
        listComments: mock(() =>
          Promise.resolve({ data: [] }),
        ),
        updateComment: mock(() => Promise.resolve({ data: {} })),
        update: mock(() => Promise.resolve({ data: {} })),
      },
    },
  } as unknown as Octokit;
}

export function createMockGithubApp(overrides: Partial<GitHubApp> = {}): GitHubApp {
  const mockOctokit = createMockOctokit();
  return {
    getInstallationOctokit: mock(() => Promise.resolve(mockOctokit)),
    getAppSlug: mock(() => "kodiai"),
    initialize: mock(() => Promise.resolve()),
    checkConnectivity: mock(() => Promise.resolve(true)),
    getInstallationToken: mock(() => Promise.resolve("token")),
    getRepoInstallationContext: mock(() =>
      Promise.resolve({ installationId: 1, defaultBranch: "master" }),
    ),
    ...overrides,
  };
}

/** Create a mock SQL tagged template that records queries and returns configurable rows. */
export function createMockSql(rows: Record<string, unknown>[] = []): { sql: Sql; calls: string[] } {
  const calls: string[] = [];
  const sqlFn = (...args: unknown[]) => {
    // Tagged template: first arg is string array, rest are values
    if (Array.isArray(args[0])) {
      const strings = args[0] as string[];
      calls.push(strings.join("?"));
    }
    return rows;
  };
  const proxy = new Proxy(sqlFn, {
    apply(target, thisArg, argArray) {
      return target.apply(thisArg, argArray);
    },
  });
  return { sql: proxy as unknown as Sql, calls };
}

export function createSilentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => createSilentLogger(),
    level: "silent",
  } as unknown as import("pino").Logger;
}
