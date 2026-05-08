import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { buildReviewOutputMarker } from "../../handlers/review-idempotency.ts";
import { sanitizeOutgoingMentions, scanOutgoingForSecrets } from "../../lib/sanitizer.ts";
import {
  createReviewOutputPublicationGate,
  type ReviewOutputPublicationGate,
} from "./review-output-publication-gate.ts";

const REVIEW_OUTPUT_MARKER_PREFIX = "kodiai:review-output-key";

type InlineCommentLocation = {
  path: string;
  line?: number;
  startLine?: number;
  side?: "LEFT" | "RIGHT";
};

type GitHubApiErrorDetails = {
  status?: number;
  requestId?: string;
  responseMessage?: string;
  responseErrors?: unknown;
};

function formatInlineCommentLocation(location: InlineCommentLocation): string {
  const side = location.side ?? "RIGHT";
  if (location.startLine !== undefined) {
    return `path "${location.path}" at ${side} lines ${location.startLine}-${location.line ?? "?"}`;
  }
  return `path "${location.path}" at ${side} line ${location.line ?? "?"}`;
}

function extractGitHubApiErrorDetails(error: unknown): GitHubApiErrorDetails {
  const candidate = error as {
    status?: unknown;
    response?: {
      data?: { message?: unknown; errors?: unknown };
      headers?: Record<string, unknown>;
    };
  };

  const headers = candidate.response?.headers;
  const requestId = typeof headers?.["x-github-request-id"] === "string"
    ? headers["x-github-request-id"]
    : undefined;

  return {
    status: typeof candidate.status === "number" ? candidate.status : undefined,
    requestId,
    responseMessage: typeof candidate.response?.data?.message === "string"
      ? candidate.response.data.message
      : undefined,
    responseErrors: candidate.response?.data?.errors,
  };
}

function formatGitHubValidationDetails(details: GitHubApiErrorDetails): string {
  const parts: string[] = [];
  if (details.status !== undefined) parts.push(`status ${details.status}`);
  if (details.responseMessage) parts.push(details.responseMessage);
  if (details.responseErrors !== undefined) {
    parts.push(`errors: ${JSON.stringify(details.responseErrors)}`);
  }
  return parts.length > 0 ? ` GitHub response: ${parts.join("; ")}.` : "";
}

export function createInlineReviewServer(
  getOctokit: () => Promise<Octokit>,
  owner: string,
  repo: string,
  prNumber: number,
  botHandles: string[],
  reviewOutputKey?: string,
  deliveryId?: string,
  logger?: Logger,
  onPublish?: () => void,
  publicationGate?: ReviewOutputPublicationGate,
) {
  const reviewOutputPublicationGate = publicationGate
    ?? (
      reviewOutputKey
        ? createReviewOutputPublicationGate({ owner, repo, prNumber, reviewOutputKey })
        : undefined
    );

  async function resolveOutputPublicationState(octokit: Octokit): Promise<"allowed" | "already-published"> {
    if (!reviewOutputKey || !reviewOutputPublicationGate) {
      return "allowed";
    }

    const idempotencyCheck = await reviewOutputPublicationGate.resolve(octokit);

    if (!idempotencyCheck.shouldPublish) {
      logger?.info(
        {
          deliveryId,
          reviewOutputKey,
          idempotencyOutcome: "already-published-skip",
          existingLocation: idempotencyCheck.existingLocation,
        },
        "Skipping inline review publication because output key already exists",
      );
      return "already-published";
    }

    return "allowed";
  }

  return createSdkMcpServer({
    name: "github_inline_comment",
    version: "0.1.0",
    tools: [
      tool(
        "create_inline_comment",
        "Create an inline comment on a specific line or lines in a PR file. " +
          "For code suggestions, use: ```suggestion\\nreplacement code\\n```. " +
          "IMPORTANT: The suggestion block will REPLACE the ENTIRE line range (single line or startLine to line). " +
          "Ensure the replacement is syntactically complete and valid.",
        {
          path: z
            .string()
            .describe("The file path to comment on (e.g., 'src/index.ts')"),
          body: z
            .string()
            .describe(
              "The comment text (supports markdown and GitHub code suggestion blocks)",
            ),
          line: z
            .number()
            .nonnegative()
            .optional()
            .describe(
              "Line number for single-line comments, or end line for multi-line comments",
            ),
          startLine: z
            .number()
            .nonnegative()
            .optional()
            .describe(
              "Start line for multi-line comments (use with line for the end line)",
            ),
          side: z
            .enum(["LEFT", "RIGHT"])
            .optional()
            .default("RIGHT")
            .describe(
              "Side of the diff: LEFT (old code) or RIGHT (new code)",
            ),
        },
        async ({ path, body, line, startLine, side }) => {
          try {
            if (line === undefined && startLine === undefined) {
              throw new Error(
                "Either 'line' for single-line comments or 'startLine' (with 'line') for multi-line comments must be provided",
              );
            }
            if (startLine !== undefined && line === undefined) {
              throw new Error(
                "Multi-line comments require both 'startLine' and 'line' so GitHub can identify the diff range",
              );
            }
            if (line !== undefined && line < 1) {
              throw new Error("Inline comment 'line' must be a 1-based GitHub diff line number");
            }
            if (startLine !== undefined && startLine < 1) {
              throw new Error("Inline comment 'startLine' must be a 1-based GitHub diff line number");
            }
            if (startLine !== undefined && line !== undefined && startLine > line) {
              throw new Error("Inline comment 'startLine' must be less than or equal to 'line'");
            }

            const octokit = await getOctokit();

            const publicationState = await resolveOutputPublicationState(octokit);
            if (publicationState === "already-published") {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      success: true,
                      skipped: true,
                      reason: "already-published",
                      review_output_key: reviewOutputKey,
                      marker_prefix: REVIEW_OUTPUT_MARKER_PREFIX,
                    }),
                  },
                ],
              };
            }

            const pr = await octokit.rest.pulls.get({
              owner,
              repo,
              pull_number: prNumber,
            });

            const sanitizedBody = sanitizeOutgoingMentions(body, botHandles);
            const scanResult = scanOutgoingForSecrets(sanitizedBody);
            if (scanResult.blocked) {
              logger?.warn({ matchedPattern: scanResult.matchedPattern, tool: "create_inline_comment" }, "Outgoing secret scan blocked publish");
              return { content: [{ type: "text" as const, text: "[SECURITY: response blocked — contained credential pattern]" }], isError: true };
            }
            const params: Record<string, unknown> = {
              owner,
              repo,
              pull_number: prNumber,
              body: reviewOutputKey
                ? `${sanitizedBody}\n\n${buildReviewOutputMarker(reviewOutputKey)}`
                : sanitizedBody,
              path,
              side: side || "RIGHT",
              commit_id: pr.data.head.sha,
            };

            if (startLine) {
              params.start_line = startLine;
              params.start_side = side || "RIGHT";
              params.line = line;
            } else {
              params.line = line;
            }

            const result = await octokit.rest.pulls.createReviewComment(
              params as Parameters<
                typeof octokit.rest.pulls.createReviewComment
              >[0],
            );

            onPublish?.();

            if (reviewOutputKey) {
              logger?.info(
                {
                  deliveryId,
                  reviewOutputKey,
                  idempotencyOutcome: "published",
                  reviewCommentId: result.data.id,
                  path: result.data.path,
                },
                "Published inline review output with idempotency marker",
              );
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    comment_id: result.data.id,
                    html_url: result.data.html_url,
                    path: result.data.path,
                    line: result.data.line || result.data.original_line,
                  }),
                },
              ],
            };
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            const location = formatInlineCommentLocation({ path, line, startLine, side });
            const githubErrorDetails = extractGitHubApiErrorDetails(error);

            let helpMessage = "";
            if (errorMessage.includes("Validation Failed")) {
              helpMessage =
                " This usually means the line number doesn't exist in the diff or the file path is incorrect.";
            } else if (errorMessage.includes("Not Found")) {
              helpMessage =
                " This usually means the PR number, repository, or file path is incorrect.";
            }

            logger?.warn(
              {
                deliveryId,
                reviewOutputKey,
                owner,
                repo,
                prNumber,
                tool: "create_inline_comment",
                path,
                line,
                startLine,
                side: side || "RIGHT",
                githubStatus: githubErrorDetails.status,
                githubRequestId: githubErrorDetails.requestId,
                githubResponseMessage: githubErrorDetails.responseMessage,
                githubResponseErrors: githubErrorDetails.responseErrors,
              },
              "Inline review comment publication failed",
            );

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error creating inline comment for ${location}: ${errorMessage}.${formatGitHubValidationDetails(githubErrorDetails)}${helpMessage}`,
                },
              ],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
