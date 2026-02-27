import { describe, it, expect, beforeEach, mock } from "bun:test";
import { createIssueLabelServer } from "./issue-label-server.ts";

// Helper to extract tool result from MCP server
function getTools(server: ReturnType<typeof createIssueLabelServer>) {
  // The server is a McpServerConfig which has a transport/tools structure
  // For testing, we invoke the tool handler directly
  return server;
}

// Mock Octokit factory
function createMockOctokit(overrides: {
  listLabelsForRepo?: () => Promise<any>;
  addLabels?: () => Promise<any>;
  getIssue?: () => Promise<any>;
} = {}) {
  return {
    rest: {
      issues: {
        listLabelsForRepo: overrides.listLabelsForRepo ?? (async () => ({
          data: [
            { name: "bug" },
            { name: "enhancement" },
            { name: "priority:high" },
            { name: "Documentation" },
          ],
        })),
        addLabels: overrides.addLabels ?? (async () => ({
          data: [{ name: "bug" }, { name: "priority:high" }],
        })),
        get: overrides.getIssue ?? (async () => ({
          data: { state: "open", number: 42 },
        })),
      },
    },
    paginate: async (method: any, params: any) => {
      const result = await method(params);
      return result.data;
    },
  } as any;
}

function defaultTriageConfig() {
  return { enabled: true, label: { enabled: true } };
}

describe("createIssueLabelServer", () => {
  // We need to test the tool handler. Since the MCP server uses createSdkMcpServer,
  // we'll import and test the tool logic directly by creating the server and invoking it.
  // The actual tool invocation goes through the MCP protocol, but for unit tests
  // we can test the exported factory and its behavior.

  describe("add_labels tool", () => {
    it("should apply valid labels to an issue", async () => {
      const addLabelsMock = mock(async () => ({
        data: [{ name: "bug" }, { name: "priority:high" }],
      }));

      const mockOctokit = createMockOctokit({
        addLabels: addLabelsMock,
      });

      const { addLabelsHandler } = await import("./issue-label-server.ts");
      const result = await addLabelsHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { issue_number: 42, labels: ["bug", "priority:high"] },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.applied).toEqual(["bug", "priority:high"]);
      expect(parsed.invalid).toEqual([]);
      expect(parsed.issue_number).toBe(42);
      expect(parsed.repo).toBe("testowner/testrepo");
      expect(parsed.timestamp).toBeDefined();
      expect(addLabelsMock).toHaveBeenCalled();
    });

    it("should match labels case-insensitively", async () => {
      const addLabelsMock = mock(async () => ({
        data: [{ name: "bug" }],
      }));

      const mockOctokit = createMockOctokit({
        addLabels: addLabelsMock,
      });

      const { addLabelsHandler } = await import("./issue-label-server.ts");
      const result = await addLabelsHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { issue_number: 42, labels: ["BUG"] },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.applied).toEqual(["bug"]);
    });

    it("should partially apply labels - valid applied, invalid reported", async () => {
      const addLabelsMock = mock(async () => ({
        data: [{ name: "bug" }],
      }));

      const mockOctokit = createMockOctokit({
        addLabels: addLabelsMock,
      });

      const { addLabelsHandler } = await import("./issue-label-server.ts");
      const result = await addLabelsHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { issue_number: 42, labels: ["bug", "nonexistent"] },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.applied).toEqual(["bug"]);
      expect(parsed.invalid).toEqual(["nonexistent"]);
    });

    it("should error when all labels are invalid", async () => {
      const addLabelsMock = mock(async () => ({}));
      const mockOctokit = createMockOctokit({
        addLabels: addLabelsMock,
      });

      const { addLabelsHandler } = await import("./issue-label-server.ts");
      const result = await addLabelsHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { issue_number: 42, labels: ["fake1", "fake2"] },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error_code).toBe("LABEL_NOT_FOUND");
      expect(parsed.invalid_labels).toEqual(["fake1", "fake2"]);
      expect(addLabelsMock).not.toHaveBeenCalled();
    });

    it("should warn when operating on closed issues", async () => {
      const mockOctokit = createMockOctokit({
        getIssue: async () => ({
          data: { state: "closed", number: 42 },
        }),
      });

      const { addLabelsHandler } = await import("./issue-label-server.ts");
      const result = await addLabelsHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { issue_number: 42, labels: ["bug"] },
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

      const { addLabelsHandler } = await import("./issue-label-server.ts");
      const result = await addLabelsHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { issue_number: 999, labels: ["bug"] },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error_code).toBe("ISSUE_NOT_FOUND");
    });

    it("should return PERMISSION_DENIED for 403 errors", async () => {
      const mockOctokit = createMockOctokit({
        addLabels: async () => {
          const err = new Error("Forbidden") as any;
          err.status = 403;
          throw err;
        },
      });

      const { addLabelsHandler } = await import("./issue-label-server.ts");
      const result = await addLabelsHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { issue_number: 42, labels: ["bug"] },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error_code).toBe("PERMISSION_DENIED");
    });

    it("should retry on rate limit (429) and succeed", async () => {
      let callCount = 0;
      const mockOctokit = createMockOctokit({
        addLabels: async () => {
          callCount++;
          if (callCount === 1) {
            const err = new Error("Rate limited") as any;
            err.status = 429;
            err.response = { headers: { "retry-after": "0" } };
            throw err;
          }
          return { data: [{ name: "bug" }] };
        },
      });

      const { addLabelsHandler } = await import("./issue-label-server.ts");
      const result = await addLabelsHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { issue_number: 42, labels: ["bug"] },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(callCount).toBe(2);
    });

    it("should return TOOL_DISABLED when config disables label tool", async () => {
      const mockOctokit = createMockOctokit();

      const { addLabelsHandler } = await import("./issue-label-server.ts");
      const result = await addLabelsHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: () => ({ enabled: true, label: { enabled: false } }),
        params: { issue_number: 42, labels: ["bug"] },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error_code).toBe("TOOL_DISABLED");
    });

    it("should return TOOL_DISABLED when triage is globally disabled", async () => {
      const mockOctokit = createMockOctokit();

      const { addLabelsHandler } = await import("./issue-label-server.ts");
      const result = await addLabelsHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: () => ({ enabled: false, label: { enabled: true } }),
        params: { issue_number: 42, labels: ["bug"] },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error_code).toBe("TOOL_DISABLED");
    });

    it("should include metadata in success response", async () => {
      const mockOctokit = createMockOctokit();

      const { addLabelsHandler } = await import("./issue-label-server.ts");
      const result = await addLabelsHandler({
        getOctokit: async () => mockOctokit,
        owner: "testowner",
        repo: "testrepo",
        getTriageConfig: defaultTriageConfig,
        params: { issue_number: 42, labels: ["bug"] },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.issue_number).toBe(42);
      expect(parsed.repo).toBe("testowner/testrepo");
      expect(parsed.timestamp).toBeDefined();
      expect(typeof parsed.timestamp).toBe("string");
    });
  });
});
