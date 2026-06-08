import { describe, expect, it, mock } from "bun:test";
import type { Octokit } from "@octokit/rest";
import { createWikiPublisher } from "./wiki-publisher.ts";
import {
  createMockGithubApp,
  createMockSql,
  createSilentLogger,
} from "./wiki-publisher.test-helpers.ts";

describe("createWikiPublisher — retrofitPreview", () => {
  it("update path: returns action=update with existingCommentId when marker found", async () => {
    const listComments = mock(() =>
      Promise.resolve({
        data: [
          { id: 7001, body: "<!-- kodiai:wiki-modification:42 -->\n## Test page content" },
        ],
      }),
    );
    const createComment = mock(() => Promise.resolve({ data: { id: 9999 } }));
    const updateComment = mock(() => Promise.resolve({ data: {} }));

    const mockOctokit = {
      rest: {
        issues: {
          listComments,
          createComment,
          updateComment,
          create: mock(() => Promise.resolve({ data: { number: 1, html_url: "" } })),
          update: mock(() => Promise.resolve({ data: {} })),
        },
      },
    } as unknown as Octokit;

    const githubApp = createMockGithubApp({
      getInstallationOctokit: mock(() => Promise.resolve(mockOctokit)),
    });
    const { sql } = createMockSql([
      {
        id: 1,
        page_id: 42,
        page_title: "Test Page",
        section_heading: "Intro",
        suggestion: "New text",
        why_summary: "Reason",
        citing_prs: [],
        voice_mismatch_warning: false,
      },
    ]);
    const logger = createSilentLogger();

    const publisher = createWikiPublisher({ sql, githubApp, logger, commentDelayMs: 0 });
    const result = await publisher.publish({ retrofitPreview: true, issueNumber: 50 });

    expect(result.retrofitPreviewResult).toBeDefined();
    expect(result.retrofitPreviewResult!.issueNumber).toBe(50);
    expect(result.retrofitPreviewResult!.actions).toHaveLength(1);
    expect(result.retrofitPreviewResult!.actions[0]!.action).toBe("update");
    expect(result.retrofitPreviewResult!.actions[0]!.existingCommentId).toBe(7001);
    expect(result.retrofitPreviewResult!.actions[0]!.pageId).toBe(42);
  });

  it("create path: returns action=create with existingCommentId=null when no marker found", async () => {
    const listComments = mock(() =>
      Promise.resolve({ data: [] }),
    );
    const createComment = mock(() => Promise.resolve({ data: { id: 9999 } }));
    const updateComment = mock(() => Promise.resolve({ data: {} }));

    const mockOctokit = {
      rest: {
        issues: {
          listComments,
          createComment,
          updateComment,
          create: mock(() => Promise.resolve({ data: { number: 1, html_url: "" } })),
          update: mock(() => Promise.resolve({ data: {} })),
        },
      },
    } as unknown as Octokit;

    const githubApp = createMockGithubApp({
      getInstallationOctokit: mock(() => Promise.resolve(mockOctokit)),
    });
    const { sql } = createMockSql([
      {
        id: 1,
        page_id: 99,
        page_title: "PipeWire",
        section_heading: "Overview",
        suggestion: "PipeWire replaces PulseAudio",
        why_summary: "PR #30000",
        citing_prs: [],
        voice_mismatch_warning: false,
      },
    ]);
    const logger = createSilentLogger();

    const publisher = createWikiPublisher({ sql, githubApp, logger, commentDelayMs: 0 });
    const result = await publisher.publish({ retrofitPreview: true, issueNumber: 50 });

    expect(result.retrofitPreviewResult).toBeDefined();
    expect(result.retrofitPreviewResult!.actions[0]!.action).toBe("create");
    expect(result.retrofitPreviewResult!.actions[0]!.existingCommentId).toBeNull();
  });

  it("no-mutation: createComment and updateComment are never called during retrofitPreview", async () => {
    const listComments = mock(() =>
      Promise.resolve({
        data: [
          { id: 5001, body: "<!-- kodiai:wiki-modification:42 -->\n## Some page" },
        ],
      }),
    );
    const createComment = mock(() => Promise.resolve({ data: { id: 9999 } }));
    const updateComment = mock(() => Promise.resolve({ data: {} }));

    const mockOctokit = {
      rest: {
        issues: {
          listComments,
          createComment,
          updateComment,
          create: mock(() => Promise.resolve({ data: { number: 1, html_url: "" } })),
          update: mock(() => Promise.resolve({ data: {} })),
        },
      },
    } as unknown as Octokit;

    const githubApp = createMockGithubApp({
      getInstallationOctokit: mock(() => Promise.resolve(mockOctokit)),
    });
    const { sql } = createMockSql([
      {
        id: 1,
        page_id: 42,
        page_title: "Advanced Settings",
        section_heading: null,
        suggestion: "Some text",
        why_summary: "Reason",
        citing_prs: [],
        voice_mismatch_warning: false,
      },
    ]);
    const logger = createSilentLogger();

    const publisher = createWikiPublisher({ sql, githubApp, logger, commentDelayMs: 0 });
    await publisher.publish({ retrofitPreview: true, issueNumber: 50 });

    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("scans comments once for all page actions during retrofitPreview", async () => {
    const listComments = mock(() =>
      Promise.resolve({
        data: [
          { id: 5001, body: "<!-- kodiai:wiki-modification:42 -->\n## Some page" },
          { id: 5002, body: "<!-- kodiai:wiki-modification:99 -->\n## Other page" },
        ],
      }),
    );
    const createComment = mock(() => Promise.resolve({ data: { id: 9999 } }));
    const updateComment = mock(() => Promise.resolve({ data: {} }));

    const mockOctokit = {
      rest: {
        issues: {
          listComments,
          createComment,
          updateComment,
          create: mock(() => Promise.resolve({ data: { number: 1, html_url: "" } })),
          update: mock(() => Promise.resolve({ data: {} })),
        },
      },
    } as unknown as Octokit;

    const githubApp = createMockGithubApp({
      getInstallationOctokit: mock(() => Promise.resolve(mockOctokit)),
    });
    const { sql } = createMockSql([
      {
        id: 1,
        page_id: 42,
        page_title: "Advanced Settings",
        section_heading: null,
        suggestion: "Some text",
        why_summary: "Reason",
        citing_prs: [],
        voice_mismatch_warning: false,
      },
      {
        id: 2,
        page_id: 99,
        page_title: "PipeWire",
        section_heading: null,
        suggestion: "Other text",
        why_summary: "Reason",
        citing_prs: [],
        voice_mismatch_warning: false,
      },
    ]);
    const logger = createSilentLogger();

    const publisher = createWikiPublisher({ sql, githubApp, logger, commentDelayMs: 0 });
    const result = await publisher.publish({ retrofitPreview: true, issueNumber: 50 });

    expect(listComments).toHaveBeenCalledTimes(1);
    expect(result.retrofitPreviewResult!.actions.map((action) => action.existingCommentId)).toEqual([
      5001,
      5002,
    ]);
    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).not.toHaveBeenCalled();
  });
});
