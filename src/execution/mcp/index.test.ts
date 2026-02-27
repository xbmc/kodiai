import { describe, it, expect } from "bun:test";
import { buildMcpServers, buildAllowedMcpTools } from "./index.ts";

// Minimal mock dependencies
function createMinimalDeps(overrides: Record<string, any> = {}) {
  return {
    getOctokit: async () => ({} as any),
    owner: "testowner",
    repo: "testrepo",
    ...overrides,
  };
}

describe("buildMcpServers", () => {
  describe("issue tools registration", () => {
    it("should register both issue tools when enableIssueTools is true and triageConfig provided", () => {
      const servers = buildMcpServers(
        createMinimalDeps({
          enableIssueTools: true,
          triageConfig: {
            enabled: true,
            label: { enabled: true },
            comment: { enabled: true },
          },
        }),
      );

      expect("github_issue_label" in servers).toBe(true);
      expect("github_issue_comment" in servers).toBe(true);
    });

    it("should NOT register issue tools by default", () => {
      const servers = buildMcpServers(createMinimalDeps());

      expect("github_issue_label" in servers).toBe(false);
      expect("github_issue_comment" in servers).toBe(false);
    });

    it("should NOT register issue tools when enableIssueTools is true but no triageConfig", () => {
      const servers = buildMcpServers(
        createMinimalDeps({
          enableIssueTools: true,
        }),
      );

      expect("github_issue_label" in servers).toBe(false);
      expect("github_issue_comment" in servers).toBe(false);
    });

    it("should NOT register issue tools when enableIssueTools is false", () => {
      const servers = buildMcpServers(
        createMinimalDeps({
          enableIssueTools: false,
          triageConfig: {
            enabled: true,
            label: { enabled: true },
            comment: { enabled: true },
          },
        }),
      );

      expect("github_issue_label" in servers).toBe(false);
      expect("github_issue_comment" in servers).toBe(false);
    });
  });

  describe("existing tools unaffected", () => {
    it("should still register github_comment by default", () => {
      const servers = buildMcpServers(createMinimalDeps());

      expect("github_comment" in servers).toBe(true);
    });

    it("should keep existing tools when issue tools are added", () => {
      const servers = buildMcpServers(
        createMinimalDeps({
          enableIssueTools: true,
          triageConfig: {
            enabled: true,
            label: { enabled: true },
            comment: { enabled: true },
          },
        }),
      );

      // Existing tool still present
      expect("github_comment" in servers).toBe(true);
      // New tools also present
      expect("github_issue_label" in servers).toBe(true);
      expect("github_issue_comment" in servers).toBe(true);
    });
  });
});

describe("buildAllowedMcpTools", () => {
  it("should map issue tool names to mcp__ patterns", () => {
    const result = buildAllowedMcpTools([
      "github_issue_label",
      "github_issue_comment",
    ]);

    expect(result).toEqual([
      "mcp__github_issue_label__*",
      "mcp__github_issue_comment__*",
    ]);
  });
});
