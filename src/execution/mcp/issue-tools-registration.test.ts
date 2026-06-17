import { describe, expect, it } from "bun:test";
import { buildMcpServerFactories, buildMcpServers } from "./index.ts";
import { createMinimalMcpDeps } from "./test-helpers.ts";

describe("issue MCP tools registration", () => {
  it("registers issue tools when enabled with triage config and a bound issue number", () => {
    const servers = buildMcpServers(
      createMinimalMcpDeps({
        issueTools: {
          issueNumber: 42,
          triageConfig: {
            enabled: true,
            label: { enabled: true },
            comment: { enabled: true },
          },
        },
      }),
    );

    expect("github_issue_label" in servers).toBe(true);
    expect("github_issue_comment" in servers).toBe(true);
  });

  it("fails fast when issue tools are enabled without a bound issue number", () => {
    expect(() =>
      buildMcpServers(
        createMinimalMcpDeps({
          enableIssueTools: true,
          triageConfig: {
            enabled: true,
            label: { enabled: true },
            comment: { enabled: true },
          },
        }),
      ),
    ).toThrow("Issue MCP tools require issueNumber");
  });

  it("does not register issue tools by default", () => {
    const servers = buildMcpServers(createMinimalMcpDeps());

    expect("github_issue_label" in servers).toBe(false);
    expect("github_issue_comment" in servers).toBe(false);
  });

  it("fails fast when issue tools are enabled without triage config", () => {
    expect(() =>
      buildMcpServers(
        createMinimalMcpDeps({
          enableIssueTools: true,
          issueNumber: 42,
        }),
      ),
    ).toThrow("Issue MCP tools require triageConfig");
  });

  it("does not register issue tools when disabled", () => {
    const servers = buildMcpServers(
      createMinimalMcpDeps({
        enableIssueTools: false,
        issueNumber: 42,
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

  it("preserves existing comment tools when issue tools are added", () => {
    const servers = buildMcpServers(
      createMinimalMcpDeps({
        issueTools: {
          issueNumber: 42,
          triageConfig: {
            enabled: true,
            label: { enabled: true },
            comment: { enabled: true },
          },
        },
      }),
    );

    expect("github_comment" in servers).toBe(true);
    expect("github_issue_label" in servers).toBe(true);
    expect("github_issue_comment" in servers).toBe(true);
  });

  it("fails fast when issue tool factories are requested without a bound issue number", () => {
    expect(() =>
      buildMcpServerFactories(
        createMinimalMcpDeps({
          enableIssueTools: true,
          triageConfig: {
            enabled: true,
            label: { enabled: true },
            comment: { enabled: true },
          },
        }),
      ),
    ).toThrow("Issue MCP tools require issueNumber");
  });
});
