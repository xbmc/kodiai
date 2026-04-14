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
            if (!line && !startLine) {
              throw new Error(
                "Either 'line' for single-line comments or 'startLine' (with 'line') for multi-line comments must be provided",
              );
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

            let helpMessage = "";
            if (errorMessage.includes("Validation Failed")) {
              helpMessage =
                " This usually means the line number doesn't exist in the diff or the file path is incorrect.";
            } else if (errorMessage.includes("Not Found")) {
              helpMessage =
                " This usually means the PR number, repository, or file path is incorrect.";
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error creating inline comment: ${errorMessage}${helpMessage}`,
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
