import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { sanitizeOutgoingMentions, scanOutgoingForSecrets } from "../../lib/sanitizer.ts";
import { retryGitHubRateLimitOnly } from "../../lib/github-retry.ts";

const MAX_COMMENT_LENGTH = 60000;
const TRUNCATION_NOTE = "\n\n---\n*Comment truncated due to length.*";

interface TriageCommentConfig {
  enabled: boolean;
  comment: { enabled: boolean };
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
      return {
        error_code: "ISSUE_NOT_FOUND",
        message: getErrorMessage(error, "Issue not found"),
      };
    case 403:
      return { error_code: "PERMISSION_DENIED", message: getErrorMessage(error, "Permission denied") };
    case 429:
      return { error_code: "RATE_LIMITED", message: getErrorMessage(error, "Rate limited") };
    default:
      return { error_code: "UNKNOWN_ERROR", message: getErrorMessage(error, String(error)) };
  }
}

function formatStructuredComment(structured: {
  title: string;
  body: string;
  suggestions?: string[];
}): string {
  const parts: string[] = [];
  parts.push(`## ${structured.title}`);
  parts.push("");
  parts.push(structured.body);

  if (structured.suggestions && structured.suggestions.length > 0) {
    parts.push("");
    parts.push("**Suggestions:**");
    for (const suggestion of structured.suggestions) {
      parts.push(`- ${suggestion}`);
    }
  }

  return parts.join("\n");
}

function enforceMaxLength(body: string): string {
  if (body.length <= MAX_COMMENT_LENGTH) {
    return body;
  }
  const truncated = body.slice(0, MAX_COMMENT_LENGTH - TRUNCATION_NOTE.length);
  return truncated + TRUNCATION_NOTE;
}

function resolveBody(params: {
  body?: string;
  structured?: { title: string; body: string; suggestions?: string[] };
}): string {
  if (params.body) {
    return enforceMaxLength(params.body);
  }
  if (params.structured) {
    return enforceMaxLength(formatStructuredComment(params.structured));
  }
  return "";
}

/**
 * Exported handler for testing purposes.
 */
export async function createCommentHandler(deps: {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  getTriageConfig: () => TriageCommentConfig;
  botHandles: string[];
  issueNumber: number;
  params: {
    body?: string;
    structured?: { title: string; body: string; suggestions?: string[] };
  };
}): Promise<ToolResult> {
  const { getOctokit, owner, repo, getTriageConfig, botHandles, issueNumber, params } = deps;

  try {
    // Check config gating
    const config = getTriageConfig();
    if (!config.enabled || !config.comment.enabled) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error_code: "TOOL_DISABLED",
              message: "Issue comment tool is disabled for this repository",
            }),
          },
        ],
      };
    }

    const octokit = await getOctokit();
    const rawBody = resolveBody(params);
    const body = sanitizeOutgoingMentions(rawBody, botHandles);
    const scanResult = scanOutgoingForSecrets(body);
    if (scanResult.blocked) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error_code: "SECRET_SCAN_BLOCKED",
              message: "[SECURITY: response blocked — contained credential pattern]",
            }),
          },
        ],
        isError: true,
      };
    }

    // Check issue state for closed warning
    let warning: string | null = null;
    const { data: issue } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    if (issue.state === "closed") {
      warning = "Issue is closed";
    }

    // Post comment with retry
    const { data } = await retryGitHubRateLimitOnly(() =>
      octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
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
            comment_id: data.id,
            comment_url: data.html_url,
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

export function createIssueCommentServer(params: {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  getTriageConfig: () => TriageCommentConfig;
  botHandles?: string[];
  issueNumber: number;
}) {
  const {
    getOctokit,
    owner,
    repo,
    getTriageConfig,
    botHandles = [],
    issueNumber,
  } = params;
  const structuredSchema = z.object({
    title: z.string().describe("Comment title (rendered as ## heading)"),
    body: z.string().describe("Comment body text"),
    suggestions: z
      .array(z.string())
      .optional()
      .describe("Actionable suggestions as bullet list"),
  });

  return createSdkMcpServer({
    name: "github_issue_comment",
    version: "0.1.0",
    tools: [
      tool(
        "create_comment",
        "Create a new comment on the triggering GitHub issue. Supports raw markdown or structured input (title/body/suggestions). Comments are truncated if they exceed the maximum length.",
        {
          body: z
            .string()
            .optional()
            .describe("Raw markdown comment body (provide this OR structured)"),
          structured: structuredSchema
            .optional()
            .describe("Structured comment input (provide this OR body)"),
        },
        async ({ body, structured }, _extra) => {
          return createCommentHandler({
            getOctokit,
            owner,
            repo,
            getTriageConfig,
            botHandles,
            issueNumber,
            params: { body, structured },
          });
        },
      ),
    ],
  });
}
