import { describe, it, expect, mock } from "bun:test";

// Mock Octokit factory
function createMockOctokit(overrides: {
  createComment?: () => Promise<any>;
  updateComment?: () => Promise<any>;
  getIssue?: () => Promise<any>;
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
        updateComment: overrides.updateComment ?? (async () => ({
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
        params: { issue_number: 42, body: "## Missing Fields\nPlease fill in..." },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.comment_id).toBe(12345);
      expect(parsed.comment_url).toBe("https://github.com/testowner/testrepo/issues/42#issuecomment-12345");
      expect(createCommentMock).toHaveBeenCalled();
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
        params: {
          issue_number: 42,
          structured: {
            title: "Missing Fields",
            body: "Please fill in the required sections.",
            suggestions: ["Add reproduction steps", "Include OS version"],
          },
        },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);

      // Verify the body was formatted correctly
      const callArgs = createCommentMock.mock.calls[0][0];
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
        params: { issue_number: 42, body: "Test comment" },
      });

      const callArgs = createCommentMock.mock.calls[0][0];
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
        params: { issue_number: 42, body: longBody },
      });

      const callArgs = createCommentMock.mock.calls[0][0];
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
        params: { issue_number: 42, body: "Test" },
      });

      const parsed = JSON.parse(result.content[0].text);
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
        params: { issue_number: 999, body: "Test" },
      });

      const parsed = JSON.parse(result.content[0].text);
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
        params: { issue_number: 42, body: "Test" },
      });

      const parsed = JSON.parse(result.content[0].text);
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
        params: { issue_number: 42, body: "Test" },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(callCount).toBe(2);
    });

    it("should return TOOL_DISABLED when config disables comment tool", async () => {
      const mockOctokit = createMockOctokit();

      const { createCommentHandler } = await import("./issue-comment-server.ts");
      const result = await createCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: () => ({ enabled: true, comment: { enabled: false } }),
        params: { issue_number: 42, body: "Test" },
      });

      const parsed = JSON.parse(result.content[0].text);
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
        params: { issue_number: 42, body: "Test" },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.issue_number).toBe(42);
      expect(parsed.repo).toBe("testowner/testrepo");
      expect(parsed.comment_id).toBeDefined();
      expect(parsed.comment_url).toBeDefined();
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe("update_comment tool", () => {
    it("should update an existing comment by ID", async () => {
      const updateCommentMock = mock(async () => ({
        data: {
          id: 12345,
          html_url: "https://github.com/testowner/testrepo/issues/42#issuecomment-12345",
        },
      }));

      const mockOctokit = createMockOctokit({ updateComment: updateCommentMock });

      const { updateCommentHandler } = await import("./issue-comment-server.ts");
      const result = await updateCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { comment_id: 12345, body: "Updated comment" },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.comment_id).toBe(12345);
      expect(updateCommentMock).toHaveBeenCalled();
    });

    it("should return COMMENT_NOT_FOUND for 404 errors", async () => {
      const mockOctokit = createMockOctokit({
        updateComment: async () => {
          const err = new Error("Not Found") as any;
          err.status = 404;
          throw err;
        },
      });

      const { updateCommentHandler } = await import("./issue-comment-server.ts");
      const result = await updateCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { comment_id: 99999, body: "Updated comment" },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error_code).toBe("COMMENT_NOT_FOUND");
    });

    it("should truncate body on update when exceeding max length", async () => {
      const updateCommentMock = mock(async (_params: any) => ({
        data: { id: 12345, html_url: "https://github.com/test/test/issues/1#issuecomment-12345" },
      }));

      const mockOctokit = createMockOctokit({ updateComment: updateCommentMock });

      const longBody = "y".repeat(61000);

      const { updateCommentHandler } = await import("./issue-comment-server.ts");
      await updateCommentHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { comment_id: 12345, body: longBody },
      });

      const callArgs = updateCommentMock.mock.calls[0][0];
      const body: string = callArgs.body;
      expect(body.length).toBeLessThanOrEqual(60100);
      expect(body).toContain("Comment truncated due to length.");
    });
  });
});
