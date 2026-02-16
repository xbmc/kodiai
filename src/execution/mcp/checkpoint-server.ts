import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Logger } from "pino";
import type { KnowledgeStore } from "../../knowledge/types.ts";

export function createCheckpointServer(
  knowledgeStore: KnowledgeStore,
  reviewOutputKey: string,
  repo: string,
  prNumber: number,
  totalFiles: number,
  logger?: Logger,
) {
  return createSdkMcpServer({
    name: "review_checkpoint",
    version: "0.1.0",
    tools: [
      tool(
        "save_review_checkpoint",
        "Save partial review progress. Call after reviewing each batch of files. If the session times out, saved progress will be published as a partial review.",
        {
          filesReviewed: z
            .array(z.string())
            .describe("File paths that have been fully reviewed so far"),
          findingCount: z
            .number()
            .describe("Total number of findings generated so far"),
          summaryDraft: z
            .string()
            .describe(
              "Draft summary of findings so far (will be used as partial review body)",
            ),
        },
        async ({ filesReviewed, findingCount, summaryDraft }) => {
          try {
            if (!knowledgeStore.saveCheckpoint) {
              logger?.warn(
                { reviewOutputKey, repo, prNumber },
                "Checkpoint storage unavailable: knowledgeStore.saveCheckpoint is undefined",
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      saved: false,
                      reason: "checkpoint storage unavailable",
                    }),
                  },
                ],
              };
            }

            knowledgeStore.saveCheckpoint({
              reviewOutputKey,
              repo,
              prNumber,
              filesReviewed,
              findingCount,
              summaryDraft,
              totalFiles,
            });

            logger?.debug(
              {
                reviewOutputKey,
                repo,
                prNumber,
                filesReviewed: filesReviewed.length,
                totalFiles,
                findingCount,
              },
              "Saved review checkpoint",
            );

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    saved: true,
                    filesReviewed: filesReviewed.length,
                    totalFiles,
                  }),
                },
              ],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
