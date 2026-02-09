import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { Octokit } from "@octokit/rest";
import { z } from "zod";
import { wrapInDetails } from "../../lib/formatting.ts";

export function createReviewCommentThreadServer(
  getOctokit: () => Promise<Octokit>,
  owner: string,
  repo: string,
) {
  return createSdkMcpServer({
    name: "reviewCommentThread",
    version: "0.1.0",
    tools: [
      tool(
        "reply_to_pr_review_comment",
        "Reply in-thread to an existing PR review comment (inline diff comment)",
        {
          pullRequestNumber: z.number().describe("Pull request number"),
          commentId: z.number().describe("PR review comment ID to reply to"),
          body: z
            .string()
            .describe("Reply body (GitHub-flavored markdown). Will be wrapped in <details> tags."),
        },
        async ({ pullRequestNumber, commentId, body }) => {
          try {
            const octokit = await getOctokit();

            const { data } = await octokit.rest.pulls.createReplyForReviewComment({
              owner,
              repo,
              pull_number: pullRequestNumber,
              comment_id: commentId,
              body: wrapInDetails(body, "kodiai response"),
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    comment_id: data.id,
                    html_url: (data as { html_url?: string }).html_url,
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
