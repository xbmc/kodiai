import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  formatPageComment,
  formatSummaryTable,
  postCommentWithRetry,
  createWikiPublisher,
} from "./wiki-publisher.ts";
import type { PageSuggestionGroup, PagePostResult } from "./wiki-publisher-types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { Octokit } from "@octokit/rest";

// ── Test helpers ────────────────────────────────────────────────────────

function makeGroup(overrides: Partial<PageSuggestionGroup> = {}): PageSuggestionGroup {
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

function makePageResult(overrides: Partial<PagePostResult> = {}): PagePostResult {
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

function createMockOctokit() {
  return {
    rest: {
      issues: {
        create: mock(() =>
          Promise.resolve({
            data: { number: 42, html_url: "https://github.com/xbmc/wiki/issues/42" },
          }),
        ),
        createComment: mock(() =>
          Promise.resolve({ data: { id: 99001 } }),
        ),
        update: mock(() => Promise.resolve({ data: {} })),
      },
    },
  } as unknown as Octokit;
}

function createMockGithubApp(overrides: Partial<GitHubApp> = {}): GitHubApp {
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
function createMockSql(rows: Record<string, unknown>[] = []) {
  const calls: string[] = [];
  const sqlFn = (...args: unknown[]) => {
    // Tagged template: first arg is string array, rest are values
    if (Array.isArray(args[0])) {
      const strings = args[0] as string[];
      calls.push(strings.join("?"));
    }
    return rows;
  };
  // sql`` as tagged template returns a fragment that can be composed
  // For UPDATE statements that return no rows, the mock returns []
  const proxy = new Proxy(sqlFn, {
    apply(target, thisArg, argArray) {
      return target.apply(thisArg, argArray);
    },
  });
  return { sql: proxy as unknown as ReturnType<typeof import("postgres").default>, calls };
}

// ── formatPageComment ───────────────────────────────────────────────────

describe("formatPageComment", () => {
  it("includes page title and wiki link", () => {
    const group = makeGroup();
    const result = formatPageComment(group, "xbmc", "xbmc");
    expect(result).toContain("## Add-on development");
    expect(result).toContain("https://kodi.wiki/view/Add-on_development");
  });

  it("includes section headings", () => {
    const group = makeGroup();
    const result = formatPageComment(group, "xbmc", "xbmc");
    expect(result).toContain("### Getting Started");
  });

  it("uses 'Introduction' for null section heading", () => {
    const group = makeGroup({
      suggestions: [
        {
          sectionHeading: null,
          suggestion: "Updated intro text.",
          whySummary: "Content outdated.",
          citingPrs: [],
          voiceMismatchWarning: false,
        },
      ],
    });
    const result = formatPageComment(group, "xbmc", "xbmc");
    expect(result).toContain("### Introduction");
  });

  it("includes PR citation links in correct format", () => {
    const group = makeGroup();
    const result = formatPageComment(group, "xbmc", "xbmc");
    expect(result).toContain(
      "[#27901](https://github.com/xbmc/xbmc/pull/27901) (New build system)",
    );
  });

  it("includes voice mismatch warning when flag is true", () => {
    const group = makeGroup({
      suggestions: [
        {
          sectionHeading: "Test",
          suggestion: "New text",
          whySummary: "Reason",
          citingPrs: [],
          voiceMismatchWarning: true,
        },
      ],
    });
    const result = formatPageComment(group, "xbmc", "xbmc");
    expect(result).toContain(":warning: **Voice mismatch**");
  });

  it("omits voice mismatch warning when flag is false", () => {
    const group = makeGroup();
    const result = formatPageComment(group, "xbmc", "xbmc");
    expect(result).not.toContain("Voice mismatch");
  });

  it("handles multiple suggestions for one page", () => {
    const group = makeGroup({
      suggestions: [
        {
          sectionHeading: "Section A",
          suggestion: "Text A",
          whySummary: "Why A",
          citingPrs: [{ prNumber: 100, prTitle: "PR A" }],
          voiceMismatchWarning: false,
        },
        {
          sectionHeading: "Section B",
          suggestion: "Text B",
          whySummary: "Why B",
          citingPrs: [{ prNumber: 200, prTitle: "PR B" }],
          voiceMismatchWarning: false,
        },
      ],
    });
    const result = formatPageComment(group, "xbmc", "xbmc");
    expect(result).toContain("### Section A");
    expect(result).toContain("### Section B");
    expect(result).toContain("#100");
    expect(result).toContain("#200");
  });

  it("URL-encodes page titles with spaces", () => {
    const group = makeGroup({ pageTitle: "Audio Pipeline Settings" });
    const result = formatPageComment(group, "xbmc", "xbmc");
    expect(result).toContain("Audio_Pipeline_Settings");
  });
});

// ── formatSummaryTable ──────────────────────────────────────────────────

describe("formatSummaryTable", () => {
  it("includes date-stamped header", () => {
    const result = formatSummaryTable("2026-03-05", [], 0);
    expect(result).toContain("# Wiki Update Suggestions — 2026-03-05");
  });

  it("includes anchor links for posted pages", () => {
    const results = [makePageResult({ commentId: 12345, success: true })];
    const result = formatSummaryTable("2026-03-05", results, 2);
    expect(result).toContain("#issuecomment-12345");
    expect(result).toContain("[View](#issuecomment-12345)");
  });

  it("shows 'skipped' for failed pages", () => {
    const results = [
      makePageResult({ success: false, commentId: null, error: "rate limited" }),
    ];
    const result = formatSummaryTable("2026-03-05", results, 0);
    expect(result).toContain("skipped: rate limited");
  });

  it("includes page and suggestion counts", () => {
    const results = [
      makePageResult({ suggestionsCount: 3, prsCount: 2 }),
      makePageResult({ pageTitle: "Other Page", suggestionsCount: 1, prsCount: 1 }),
    ];
    const result = formatSummaryTable("2026-03-05", results, 4);
    expect(result).toContain("**Pages evaluated:** 2");
    expect(result).toContain("**Suggestions posted:** 4");
  });

  it("shows voice warning column", () => {
    const results = [
      makePageResult({ hasVoiceWarnings: true }),
      makePageResult({ pageTitle: "Clean", hasVoiceWarnings: false }),
    ];
    const result = formatSummaryTable("2026-03-05", results, 3);
    expect(result).toContain("| yes |");
    expect(result).toContain("| no |");
  });
});

// ── postCommentWithRetry ────────────────────────────────────────────────

describe("postCommentWithRetry", () => {
  it("returns commentId on success", async () => {
    const octokit = createMockOctokit();
    const result = await postCommentWithRetry(octokit, "xbmc", "wiki", 1, "body");
    expect(result).toEqual({ commentId: 99001 });
  });

  it("returns null on non-403 error", async () => {
    const octokit = createMockOctokit();
    (octokit.rest.issues.createComment as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.reject({ status: 500, message: "Server error" }),
    );
    const result = await postCommentWithRetry(octokit, "xbmc", "wiki", 1, "body", 0);
    expect(result).toBeNull();
  });

  it("retries on 403 and succeeds", async () => {
    const octokit = createMockOctokit();
    let callCount = 0;
    (octokit.rest.issues.createComment as ReturnType<typeof mock>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject({ status: 403, response: { headers: { "retry-after": "0" } } });
      }
      return Promise.resolve({ data: { id: 99002 } });
    });
    const result = await postCommentWithRetry(octokit, "xbmc", "wiki", 1, "body", 1);
    expect(result).toEqual({ commentId: 99002 });
    expect(callCount).toBe(2);
  });

  it("returns null after max retries on 403", async () => {
    const octokit = createMockOctokit();
    (octokit.rest.issues.createComment as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.reject({ status: 403, response: { headers: { "retry-after": "0" } } }),
    );
    const result = await postCommentWithRetry(octokit, "xbmc", "wiki", 1, "body", 1);
    expect(result).toBeNull();
  });
});

// ── createWikiPublisher (pre-flight) ────────────────────────────────────

describe("createWikiPublisher", () => {
  describe("pre-flight check", () => {
    it("returns empty result when app not installed", async () => {
      const githubApp = createMockGithubApp({
        getRepoInstallationContext: mock(() => Promise.resolve(null)),
      });
      const { sql } = createMockSql();
      const logger = createSilentLogger();

      const publisher = createWikiPublisher({ sql, githubApp, logger });
      const result = await publisher.publish();

      expect(result.issueNumber).toBeNull();
      expect(result.pagesPosted).toBe(0);
    });

    it("proceeds when installation is found", async () => {
      const mockOctokit = createMockOctokit();
      const githubApp = createMockGithubApp({
        getInstallationOctokit: mock(() => Promise.resolve(mockOctokit)),
      });
      const { sql } = createMockSql([]); // no suggestions
      const logger = createSilentLogger();

      const publisher = createWikiPublisher({ sql, githubApp, logger });
      const result = await publisher.publish();

      // Pre-flight passed, but no suggestions → early return
      expect(result.issueNumber).toBeNull();
      expect(result.pagesPosted).toBe(0);
    });
  });

  describe("dry-run", () => {
    it("does not call GitHub API in dry-run mode", async () => {
      const githubApp = createMockGithubApp();
      const { sql } = createMockSql([
        {
          id: 1,
          page_id: 100,
          page_title: "Test Page",
          section_heading: "Intro",
          suggestion: "New text",
          why_summary: "Reason",
          citing_prs: [{ prNumber: 1, prTitle: "PR 1" }],
          voice_mismatch_warning: false,
        },
      ]);
      const logger = createSilentLogger();

      const publisher = createWikiPublisher({ sql, githubApp, logger });
      const result = await publisher.publish({ dryRun: true });

      expect(result.issueNumber).toBeNull();
      expect(result.pagesPosted).toBe(1);
      expect(result.suggestionsPublished).toBe(1);
      expect(result.dryRunOutput).toContain("## Test Page");
      // getRepoInstallationContext should NOT have been called
      expect(githubApp.getRepoInstallationContext).not.toHaveBeenCalled();
    });

    it("returns formatted markdown in dryRunOutput", async () => {
      const githubApp = createMockGithubApp();
      const { sql } = createMockSql([
        {
          id: 1,
          page_id: 100,
          page_title: "Audio Pipeline",
          section_heading: null,
          suggestion: "Updated pipeline info",
          why_summary: "PipeWire switch",
          citing_prs: [{ prNumber: 27901, prTitle: "Switch to PipeWire" }],
          voice_mismatch_warning: false,
        },
      ]);
      const logger = createSilentLogger();

      const publisher = createWikiPublisher({ sql, githubApp, logger });
      const result = await publisher.publish({ dryRun: true });

      expect(result.dryRunOutput).toContain("## Audio Pipeline");
      expect(result.dryRunOutput).toContain("### Introduction");
      expect(result.dryRunOutput).toContain("#27901");
    });
  });

  describe("full publish flow", () => {
    it("creates issue, posts comments, updates body", async () => {
      const mockOctokit = createMockOctokit();
      const githubApp = createMockGithubApp({
        getInstallationOctokit: mock(() => Promise.resolve(mockOctokit)),
      });
      const { sql } = createMockSql([
        {
          id: 1,
          page_id: 100,
          page_title: "Test Page",
          section_heading: "Section A",
          suggestion: "New content",
          why_summary: "PR updated this",
          citing_prs: [{ prNumber: 42, prTitle: "Big change" }],
          voice_mismatch_warning: false,
        },
      ]);
      const logger = createSilentLogger();

      const publisher = createWikiPublisher({
        sql,
        githubApp,
        logger,
        commentDelayMs: 0, // no delay in tests
      });
      const result = await publisher.publish();

      expect(result.issueNumber).toBe(42);
      expect(result.issueUrl).toBe("https://github.com/xbmc/wiki/issues/42");
      expect(result.pagesPosted).toBe(1);
      expect(result.pagesSkipped).toBe(0);
      expect(result.suggestionsPublished).toBe(1);

      // Verify issue was created
      expect(mockOctokit.rest.issues.create).toHaveBeenCalledTimes(1);
      // Verify comment was posted
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
      // Verify issue body was updated with summary
      expect(mockOctokit.rest.issues.update).toHaveBeenCalledTimes(1);
    });

    it("handles partial failure — skips failed page and continues", async () => {
      const mockOctokit = createMockOctokit();
      let commentCallCount = 0;
      (mockOctokit.rest.issues.createComment as ReturnType<typeof mock>).mockImplementation(
        () => {
          commentCallCount++;
          if (commentCallCount === 1) {
            return Promise.reject({ status: 500 });
          }
          return Promise.resolve({ data: { id: 99002 } });
        },
      );

      const githubApp = createMockGithubApp({
        getInstallationOctokit: mock(() => Promise.resolve(mockOctokit)),
      });
      const { sql } = createMockSql([
        {
          id: 1,
          page_id: 100,
          page_title: "Failing Page",
          section_heading: "S1",
          suggestion: "Text",
          why_summary: "Reason",
          citing_prs: [],
          voice_mismatch_warning: false,
        },
        {
          id: 2,
          page_id: 200,
          page_title: "Succeeding Page",
          section_heading: "S2",
          suggestion: "Text 2",
          why_summary: "Reason 2",
          citing_prs: [],
          voice_mismatch_warning: false,
        },
      ]);
      const logger = createSilentLogger();

      const publisher = createWikiPublisher({
        sql,
        githubApp,
        logger,
        commentDelayMs: 0,
      });
      const result = await publisher.publish();

      expect(result.pagesPosted).toBe(1);
      expect(result.pagesSkipped).toBe(1);
      expect(result.skippedPages).toEqual([
        { pageTitle: "Failing Page", reason: "Comment post failed after retries" },
      ]);
    });
  });

  describe("issue creation", () => {
    it("creates issue with date-stamped title", async () => {
      const mockOctokit = createMockOctokit();
      const githubApp = createMockGithubApp({
        getInstallationOctokit: mock(() => Promise.resolve(mockOctokit)),
      });
      const { sql } = createMockSql([
        {
          id: 1,
          page_id: 100,
          page_title: "Test",
          section_heading: null,
          suggestion: "Text",
          why_summary: "Why",
          citing_prs: [],
          voice_mismatch_warning: false,
        },
      ]);
      const logger = createSilentLogger();

      const publisher = createWikiPublisher({
        sql,
        githubApp,
        logger,
        commentDelayMs: 0,
      });
      await publisher.publish();

      const createCall = (mockOctokit.rest.issues.create as ReturnType<typeof mock>).mock
        .calls[0];
      const args = createCall[0] as Record<string, unknown>;
      expect(args.title).toMatch(/^Wiki Update Suggestions — \d{4}-\d{2}-\d{2}$/);
      expect(args.labels).toEqual(["wiki-update", "bot-generated"]);
      expect(args.owner).toBe("xbmc");
      expect(args.repo).toBe("wiki");
    });
  });

  describe("no suggestions", () => {
    it("returns early with empty result when no unpublished suggestions", async () => {
      const mockOctokit = createMockOctokit();
      const githubApp = createMockGithubApp({
        getInstallationOctokit: mock(() => Promise.resolve(mockOctokit)),
      });
      const { sql } = createMockSql([]); // no rows
      const logger = createSilentLogger();

      const publisher = createWikiPublisher({ sql, githubApp, logger });
      const result = await publisher.publish();

      expect(result.issueNumber).toBeNull();
      expect(result.pagesPosted).toBe(0);
      // Should NOT have created an issue
      expect(mockOctokit.rest.issues.create).not.toHaveBeenCalled();
    });
  });
});

// ── Shared test utilities ───────────────────────────────────────────────

function createSilentLogger() {
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
