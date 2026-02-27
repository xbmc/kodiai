import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";

interface TriageLabelConfig {
  enabled: boolean;
  label: { enabled: boolean };
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error?.status === 429 && attempt < maxRetries) {
        const retryAfter = error?.response?.headers?.["retry-after"];
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error("unreachable");
}

function mapErrorCode(error: any): { error_code: string; message: string } {
  const status = error?.status;
  switch (status) {
    case 404:
      return { error_code: "ISSUE_NOT_FOUND", message: error.message ?? "Issue not found" };
    case 403:
      return { error_code: "PERMISSION_DENIED", message: error.message ?? "Permission denied" };
    case 429:
      return { error_code: "RATE_LIMITED", message: error.message ?? "Rate limited" };
    default:
      return { error_code: "UNKNOWN_ERROR", message: error.message ?? String(error) };
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
  params: { issue_number: number; labels: string[] };
}): Promise<ToolResult> {
  const { getOctokit, owner, repo, getTriageConfig, params } = deps;
  const { issue_number, labels } = params;

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

    // Fetch all repo labels for pre-validation
    const repoLabels = await octokit.paginate(
      octokit.rest.issues.listLabelsForRepo,
      { owner, repo, per_page: 100 },
    );

    // Build case-insensitive lookup map: lowercase -> canonical name
    const labelMap = new Map<string, string>();
    for (const label of repoLabels) {
      labelMap.set(label.name.toLowerCase(), label.name);
    }

    // Resolve requested labels against repo labels
    const validLabels: string[] = [];
    const invalidLabels: string[] = [];
    for (const requested of labels) {
      const canonical = labelMap.get(requested.toLowerCase());
      if (canonical) {
        validLabels.push(canonical);
      } else {
        invalidLabels.push(requested);
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
        issue_number,
      });
      if (issue.state === "closed") {
        warning = "Issue is closed";
      }
    } catch (error: any) {
      // If issue fetch fails with 404, propagate as ISSUE_NOT_FOUND
      if (error?.status === 404) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                ...mapErrorCode(error),
                issue_number,
                repo: `${owner}/${repo}`,
              }),
            },
          ],
        };
      }
      // Other errors during issue fetch: continue (best effort for warning)
    }

    // Apply valid labels with retry
    await withRetry(() =>
      octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number,
        labels: validLabels,
      }),
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            issue_number,
            repo: `${owner}/${repo}`,
            applied: validLabels,
            invalid: invalidLabels,
            warning,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    };
  } catch (error: any) {
    const mapped = mapErrorCode(error);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            ...mapped,
            issue_number,
            repo: `${owner}/${repo}`,
          }),
        },
      ],
    };
  }
}

export function createIssueLabelServer(
  getOctokit: () => Promise<Octokit>,
  owner: string,
  repo: string,
  getTriageConfig: () => TriageLabelConfig,
) {
  return createSdkMcpServer({
    name: "github_issue_label",
    version: "0.1.0",
    tools: [
      tool(
        "add_labels",
        "Apply labels to a GitHub issue. Labels are validated against the repository's existing labels with case-insensitive matching. Valid labels are applied even if some requested labels don't exist (partial application).",
        {
          issue_number: z.number().describe("The issue number"),
          labels: z
            .array(z.string().min(1))
            .min(1)
            .describe("Labels to apply (case-insensitive matching)"),
        },
        async ({ issue_number, labels }) => {
          return addLabelsHandler({
            getOctokit,
            owner,
            repo,
            getTriageConfig,
            params: { issue_number, labels },
          });
        },
      ),
    ],
  });
}
