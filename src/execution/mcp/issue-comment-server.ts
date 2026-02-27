import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";

const MAX_COMMENT_LENGTH = 60000;
const TRUNCATION_NOTE = "\n\n---\n*Comment truncated due to length.*";

interface TriageCommentConfig {
  enabled: boolean;
  comment: { enabled: boolean };
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

function mapErrorCode(
  error: any,
  context: "issue" | "comment" = "issue",
): { error_code: string; message: string } {
  const status = error?.status;
  switch (status) {
    case 404:
      return {
        error_code: context === "comment" ? "COMMENT_NOT_FOUND" : "ISSUE_NOT_FOUND",
        message: error.message ?? `${context === "comment" ? "Comment" : "Issue"} not found`,
      };
    case 403:
      return { error_code: "PERMISSION_DENIED", message: error.message ?? "Permission denied" };
    case 429:
      return { error_code: "RATE_LIMITED", message: error.message ?? "Rate limited" };
    default:
      return { error_code: "UNKNOWN_ERROR", message: error.message ?? String(error) };
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
  params: {
    issue_number: number;
    body?: string;
    structured?: { title: string; body: string; suggestions?: string[] };
  };
}): Promise<ToolResult> {
  const { getOctokit, owner, repo, getTriageConfig, params } = deps;
  const { issue_number } = params;

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
    const body = resolveBody(params);

    // Check issue state for closed warning
    let warning: string | null = null;
    const { data: issue } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number,
    });
    if (issue.state === "closed") {
      warning = "Issue is closed";
    }

    // Post comment with retry
    const { data } = await withRetry(() =>
      octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number,
        body,
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
            comment_id: data.id,
            comment_url: data.html_url,
            warning,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    };
  } catch (error: any) {
    const mapped = mapErrorCode(error, "issue");
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

/**
 * Exported handler for testing purposes.
 */
export async function updateCommentHandler(deps: {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  getTriageConfig: () => TriageCommentConfig;
  params: {
    comment_id: number;
    body?: string;
    structured?: { title: string; body: string; suggestions?: string[] };
  };
}): Promise<ToolResult> {
  const { getOctokit, owner, repo, getTriageConfig, params } = deps;
  const { comment_id } = params;

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
    const body = resolveBody(params);

    // Update comment with retry
    const { data } = await withRetry(() =>
      octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id,
        body,
      }),
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            comment_id: data.id,
            repo: `${owner}/${repo}`,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    };
  } catch (error: any) {
    const mapped = mapErrorCode(error, "comment");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            ...mapped,
            comment_id,
            repo: `${owner}/${repo}`,
          }),
        },
      ],
    };
  }
}

export function createIssueCommentServer(
  getOctokit: () => Promise<Octokit>,
  owner: string,
  repo: string,
  getTriageConfig: () => TriageCommentConfig,
) {
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
        "Create a new comment on a GitHub issue. Supports raw markdown or structured input (title/body/suggestions). Comments are truncated if they exceed the maximum length.",
        {
          issue_number: z.number().describe("The issue number"),
          body: z
            .string()
            .optional()
            .describe("Raw markdown comment body (provide this OR structured)"),
          structured: structuredSchema
            .optional()
            .describe("Structured comment input (provide this OR body)"),
        },
        async ({ issue_number, body, structured }) => {
          return createCommentHandler({
            getOctokit,
            owner,
            repo,
            getTriageConfig,
            params: { issue_number, body, structured },
          });
        },
      ),
      tool(
        "update_comment",
        "Update an existing comment on a GitHub issue by comment ID.",
        {
          comment_id: z.number().describe("The comment ID to update"),
          body: z
            .string()
            .optional()
            .describe("Raw markdown comment body (provide this OR structured)"),
          structured: structuredSchema
            .optional()
            .describe("Structured comment input (provide this OR body)"),
        },
        async ({ comment_id, body, structured }) => {
          return updateCommentHandler({
            getOctokit,
            owner,
            repo,
            getTriageConfig,
            params: { comment_id, body, structured },
          });
        },
      ),
    ],
  });
}
