import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { retryGitHubRateLimitOnly } from "../../lib/github-retry.ts";

interface TriageLabelConfig {
  enabled: boolean;
  label: { enabled: boolean };
}

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function getErrorStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : fallback;
}

function mapErrorCode(error: unknown): { error_code: string; message: string } {
  const status = getErrorStatus(error);
  switch (status) {
    case 404:
      return { error_code: "ISSUE_NOT_FOUND", message: getErrorMessage(error, "Issue not found") };
    case 403:
      return { error_code: "PERMISSION_DENIED", message: getErrorMessage(error, "Permission denied") };
    case 429:
      return { error_code: "RATE_LIMITED", message: getErrorMessage(error, "Rate limited") };
    default:
      return { error_code: "UNKNOWN_ERROR", message: getErrorMessage(error, String(error)) };
  }
}

/**
 * Exported handler for testing purposes.
 * The MCP server wraps this in the tool() call.
 */
export async function addLabelsHandler(deps: {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  getTriageConfig: () => TriageLabelConfig;
  issueNumber: number;
  params: { labels: string[] };
}): Promise<ToolResult> {
  const { getOctokit, owner, repo, getTriageConfig, issueNumber, params } = deps;
  const { labels } = params;

  try {
    // Check config gating (hot-reload: called on every invocation)
    const config = getTriageConfig();
    if (!config.enabled || !config.label.enabled) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error_code: "TOOL_DISABLED",
              message: "Issue label tool is disabled for this repository",
            }),
          },
        ],
      };
    }

    const octokit = await getOctokit();

    const validLabels: string[] = [];
    const invalidLabels: string[] = [];
    const seenRequestedLabels = new Set<string>();
    for (const requested of labels) {
      const normalized = requested.toLowerCase();
      if (seenRequestedLabels.has(normalized)) continue;
      seenRequestedLabels.add(normalized);
      try {
        const { data: label } = await retryGitHubRateLimitOnly(() =>
          octokit.rest.issues.getLabel({
            owner,
            repo,
            name: requested,
          }),
        );
        validLabels.push(label.name);
      } catch (error: unknown) {
        if (getErrorStatus(error) === 404) {
          invalidLabels.push(requested);
          continue;
        }
        throw error;
      }
    }

    // If all labels are invalid, return error
    if (validLabels.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error_code: "LABEL_NOT_FOUND",
              message: `None of the requested labels exist in the repository: ${invalidLabels.join(", ")}`,
              invalid_labels: invalidLabels,
            }),
          },
        ],
      };
    }

    // Check issue state for closed warning
    let warning: string | null = null;
    try {
      const { data: issue } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });
      if (issue.state === "closed") {
        warning = "Issue is closed";
      }
    } catch (error: unknown) {
      // If issue fetch fails with 404, propagate as ISSUE_NOT_FOUND
      if (getErrorStatus(error) === 404) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                ...mapErrorCode(error),
                issue_number: issueNumber,
                repo: `${owner}/${repo}`,
              }),
            },
          ],
        };
      }
      // Other errors during issue fetch: continue (best effort for warning)
    }

    // Apply valid labels with retry
    await retryGitHubRateLimitOnly(() =>
      octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels: validLabels,
      }),
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            issue_number: issueNumber,
            repo: `${owner}/${repo}`,
            applied: validLabels,
            invalid: invalidLabels,
            warning,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    };
  } catch (error: unknown) {
    const mapped = mapErrorCode(error);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            ...mapped,
            issue_number: issueNumber,
            repo: `${owner}/${repo}`,
          }),
        },
      ],
    };
  }
}

export function createIssueLabelServer(params: {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  getTriageConfig: () => TriageLabelConfig;
  issueNumber: number;
}) {
  const { getOctokit, owner, repo, getTriageConfig, issueNumber } = params;
  return createSdkMcpServer({
    name: "github_issue_label",
    version: "0.1.0",
    tools: [
      tool(
        "add_labels",
        "Apply labels to the triggering GitHub issue. Labels are validated against the repository's existing labels with case-insensitive matching. Valid labels are applied even if some requested labels don't exist (partial application).",
        {
          labels: z
            .array(z.string().min(1))
            .min(1)
            .describe("Labels to apply (case-insensitive matching)"),
        },
        async ({ labels }, _extra) => {
          return addLabelsHandler({
            getOctokit,
            owner,
            repo,
            getTriageConfig,
            issueNumber,
            params: { labels },
          });
        },
      ),
    ],
  });
}
