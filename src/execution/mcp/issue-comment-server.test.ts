import { describe, it, expect, mock } from "bun:test";
import { getToolHandler, hasRegisteredTool } from "./test-helpers.ts";

// Mock Octokit factory
function createMockOctokit(overrides: {
  createComment?: (...args: any[]) => Promise<any>;
  getIssue?: (...args: any[]) => Promise<any>;
} = {}) {
  return {
    rest: {
      issues: {
        createComment: overrides.createComment ?? (async () => ({
          data: {
            id: 12345,
            html_url: "https://github.com/testowner/testrepo/issues/42#issuecomment-12345",
          },
        })),
        get: overrides.getIssue ?? (async () => ({
          data: { state: "open", number: 42 },
        })),
      },
    },
  } as any;
}

function defaultTriageConfig() {
  return { enabled: true, comment: { enabled: true } };
}

describe("createIssueCommentServer", () => {
  it("does not expose arbitrary comment updates on the issue-bound server", async () => {
    const { createIssueCommentServer } = await import("./issue-comment-server.ts");
    const server = createIssueCommentServer({
      getOctokit: async () => createMockOctokit(),
      owner: "testowner",
      repo: "testrepo",
      getTriageConfig: defaultTriageConfig,
      botHandles: [],
      issueNumber: 42,
    });

    expect(hasRegisteredTool(server, "create_comment")).toBe(true);
    expect(hasRegisteredTool(server, "update_comment")).toBe(false);
  });

  describe("create_comment tool", () => {
    it("should create a comment with raw markdown", async () => {
      const createCommentMock = mock(async () => ({
        data: {
          id: 12345,
          html_url: "https://github.com/testowner/testrepo/issues/42#issuecomment-12345",
        },
      }));

      const mockOctokit = createMockOctokit({ createComment: createCommentMock });

      const { createCommentHandler } = await import("./issue-comment-server.ts");
      const result = await createCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        botHandles: [],
        issueNumber: 42,
        params: { body: "## Missing Fields\nPlease fill in..." },
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(true);
      expect(parsed.comment_id).toBe(12345);
      expect(parsed.comment_url).toBe("https://github.com/testowner/testrepo/issues/42#issuecomment-12345");
      expect(createCommentMock).toHaveBeenCalled();
    });

    it("uses the bound triggering issue without model-supplied issue number", async () => {
      const createCommentMock = mock(async () => ({
        data: {
          id: 12345,
          html_url: "https://github.com/testowner/testrepo/issues/42#issuecomment-12345",
        },
      }));
      const mockOctokit = createMockOctokit({ createComment: createCommentMock });

      const { createIssueCommentServer } = await import("./issue-comment-server.ts");
      const server = createIssueCommentServer({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        botHandles: [],
        issueNumber: 42,
      });
      const createComment = getToolHandler(server, "create_comment");

      const result = await createComment({ body: "Bound issue comment" });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(true);
      expect(createCommentMock).toHaveBeenCalledWith(expect.objectContaining({
        issue_number: 42,
        body: "Bound issue comment",
      }));
    });

    it("should create a comment from structured input", async () => {
      const createCommentMock = mock(async (_params: any) => ({
        data: {
          id: 12345,
          html_url: "https://github.com/testowner/testrepo/issues/42#issuecomment-12345",
        },
      }));

      const mockOctokit = createMockOctokit({ createComment: createCommentMock });

      const { createCommentHandler } = await import("./issue-comment-server.ts");
      const result = await createCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        botHandles: [],
        issueNumber: 42,
        params: {
          structured: {
            title: "Missing Fields",
            body: "Please fill in the required sections.",
            suggestions: ["Add reproduction steps", "Include OS version"],
          },
        },
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(true);

      // Verify the body was formatted correctly
      const callArgs = createCommentMock.mock.calls[0]![0];
      const body = callArgs.body;
      expect(body).toContain("## Missing Fields");
      expect(body).toContain("Please fill in the required sections.");
      expect(body).toContain("**Suggestions:**");
      expect(body).toContain("- Add reproduction steps");
      expect(body).toContain("- Include OS version");
    });

    it("should not add bot branding to comments", async () => {
      const createCommentMock = mock(async (_params: any) => ({
        data: { id: 12345, html_url: "https://github.com/test/test/issues/1#issuecomment-12345" },
      }));

      const mockOctokit = createMockOctokit({ createComment: createCommentMock });

      const { createCommentHandler } = await import("./issue-comment-server.ts");
      await createCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        botHandles: [],
        issueNumber: 42,
        params: { body: "Test comment" },
      });

      const callArgs = createCommentMock.mock.calls[0]![0];
      const body: string = callArgs.body;
      expect(body).not.toContain("Kodiai");
      expect(body).not.toContain("Posted by");
      expect(body).not.toContain("Bot");
    });

    it("should truncate comments exceeding max length", async () => {
      const createCommentMock = mock(async (_params: any) => ({
        data: { id: 12345, html_url: "https://github.com/test/test/issues/1#issuecomment-12345" },
      }));

      const mockOctokit = createMockOctokit({ createComment: createCommentMock });

      const longBody = "x".repeat(61000);

      const { createCommentHandler } = await import("./issue-comment-server.ts");
      await createCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        botHandles: [],
        issueNumber: 42,
        params: { body: longBody },
      });

      const callArgs = createCommentMock.mock.calls[0]![0];
      const body: string = callArgs.body;
      expect(body.length).toBeLessThanOrEqual(60100); // 60000 + truncation note
      expect(body).toContain("Comment truncated due to length.");
    });

    it("should warn when posting on closed issues", async () => {
      const mockOctokit = createMockOctokit({
        getIssue: async () => ({
          data: { state: "closed", number: 42 },
        }),
      });

      const { createCommentHandler } = await import("./issue-comment-server.ts");
      const result = await createCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        botHandles: [],
        issueNumber: 42,
        params: { body: "Test" },
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(true);
      expect(parsed.warning).toBe("Issue is closed");
    });

    it("should return ISSUE_NOT_FOUND for 404 errors", async () => {
      const mockOctokit = createMockOctokit({
        getIssue: async () => {
          const err = new Error("Not Found") as any;
          err.status = 404;
          throw err;
        },
      });

      const { createCommentHandler } = await import("./issue-comment-server.ts");
      const result = await createCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        botHandles: [],
        issueNumber: 999,
        params: { body: "Test" },
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(false);
      expect(parsed.error_code).toBe("ISSUE_NOT_FOUND");
    });

    it("should return PERMISSION_DENIED for 403 errors", async () => {
      const mockOctokit = createMockOctokit({
        createComment: async () => {
          const err = new Error("Forbidden") as any;
          err.status = 403;
          throw err;
        },
      });

      const { createCommentHandler } = await import("./issue-comment-server.ts");
      const result = await createCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        botHandles: [],
        issueNumber: 42,
        params: { body: "Test" },
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(false);
      expect(parsed.error_code).toBe("PERMISSION_DENIED");
    });

    it("should retry on rate limit (429) and succeed", async () => {
      let callCount = 0;
      const mockOctokit = createMockOctokit({
        createComment: async () => {
          callCount++;
          if (callCount === 1) {
            const err = new Error("Rate limited") as any;
            err.status = 429;
            err.response = { headers: { "retry-after": "0" } };
            throw err;
          }
          return {
            data: { id: 12345, html_url: "https://github.com/test/test/issues/1#issuecomment-12345" },
          };
        },
      });

      const { createCommentHandler } = await import("./issue-comment-server.ts");
      const result = await createCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        botHandles: [],
        issueNumber: 42,
        params: { body: "Test" },
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(true);
      expect(callCount).toBe(2);
    });

    it("falls back to exponential delay for malformed Retry-After values", async () => {
      const originalSetTimeout = globalThis.setTimeout;
      const delays: number[] = [];
      globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], timeout?: number) => {
        delays.push(timeout ?? 0);
        if (typeof handler === "function") handler();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof globalThis.setTimeout;

      try {
        let callCount = 0;
        const mockOctokit = createMockOctokit({
          createComment: async () => {
            callCount++;
            if (callCount === 1) {
              const err = new Error("Rate limited") as any;
              err.status = 429;
              err.response = { headers: { "retry-after": "bad-header" } };
              throw err;
            }
            return {
              data: { id: 12345, html_url: "https://github.com/test/test/issues/1#issuecomment-12345" },
            };
          },
        });

        const { createCommentHandler } = await import("./issue-comment-server.ts");
        const result = await createCommentHandler({
          getOctokit: async () => mockOctokit,
          owner: "testowner",
          repo: "testrepo",
          getTriageConfig: defaultTriageConfig,
          botHandles: [],
          issueNumber: 42,
          params: { body: "Test" },
        });

        const parsed = JSON.parse(result.content[0]!.text);
        expect(parsed.success).toBe(true);
        expect(callCount).toBe(2);
        expect(delays).toEqual([1000]);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
    });

    it("should return TOOL_DISABLED when config disables comment tool", async () => {
      const mockOctokit = createMockOctokit();

      const { createCommentHandler } = await import("./issue-comment-server.ts");
      const result = await createCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: () => ({ enabled: true, comment: { enabled: false } }),
        botHandles: [],
        issueNumber: 42,
        params: { body: "Test" },
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(false);
      expect(parsed.error_code).toBe("TOOL_DISABLED");
    });

    it("should include metadata in success response", async () => {
      const mockOctokit = createMockOctokit();

      const { createCommentHandler } = await import("./issue-comment-server.ts");
      const result = await createCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        botHandles: [],
        issueNumber: 42,
        params: { body: "Test" },
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.issue_number).toBe(42);
      expect(parsed.repo).toBe("testowner/testrepo");
      expect(parsed.comment_id).toBeDefined();
      expect(parsed.comment_url).toBeDefined();
      expect(parsed.timestamp).toBeDefined();
    });
  });
});

// --- Phase S03: Outgoing secret scan tests ---

describe("outgoing secret scan", () => {
  it("createCommentHandler blocks body containing github PAT", async () => {
    const createCommentMock = mock(async () => ({
      data: { id: 12345, html_url: "https://github.com/test/test/issues/1#issuecomment-12345" },
    }));
    const mockOctokit = createMockOctokit({ createComment: createCommentMock });

    const { createCommentHandler } = await import("./issue-comment-server.ts");
    const body = "ghp_" + "A".repeat(36);
    const result = await createCommentHandler({
      getOctokit: async () => mockOctokit,
      owner: "testowner",
      repo: "testrepo",
      getTriageConfig: defaultTriageConfig,
      botHandles: [],
      issueNumber: 42,
      params: { body },
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.error_code).toBe("SECRET_SCAN_BLOCKED");
    expect(createCommentMock).not.toHaveBeenCalled();
  });
});
