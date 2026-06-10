import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { PrDiffCommentabilityIndex } from "../formatter-suggestions.ts";
import type { ReviewOutputPublicationGate } from "./review-output-publication-gate.ts";
import { createInlineReviewPublisher } from "./inline-review-publisher.ts";

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
  prDiffForCommentValidation?: string,
  prDiffCommentabilityIndex?: PrDiffCommentabilityIndex,
) {
  const publisher = createInlineReviewPublisher({
    getOctokit,
    owner,
    repo,
    prNumber,
    botHandles,
    reviewOutputKey,
    deliveryId,
    logger,
    onPublish,
    publicationGate,
    prDiffForCommentValidation,
    prDiffCommentabilityIndex,
  });

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
          return publisher.publish({
            location: { path, line, startLine, side },
            body,
          });
        },
      ),
    ],
  });
}
