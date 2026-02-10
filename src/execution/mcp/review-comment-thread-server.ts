import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { Octokit } from "@octokit/rest";
import { z } from "zod";
import { wrapInDetails } from "../../lib/formatting.ts";

export function createReviewCommentThreadServer(
  getOctokit: () => Promise<Octokit>,
  owner: string,
  repo: string,
  onPublish?: () => void,
) {
  function sanitizeDecisionBody(wrappedBody: string): string {
    // Mirror github_comment sanitizer for decision-only responses.
    if (!wrappedBody.includes("<summary>kodiai response</summary>")) return wrappedBody;
    if (!wrappedBody.includes("Decision:")) return wrappedBody;
    // Let the comment server enforce full rules for top-level comments; here we just
    // prevent verbose prose after Issues: none.
    const lines = wrappedBody.split("\n");
    const end = lines.findIndex((l) => l.trim() === "</details>");
    if (end === -1) return wrappedBody;

    // If approved, require Issues: none and nothing else.
    const content = lines.slice(0, end).map((l) => l.trim());
    const decision = content.find((l) => l.startsWith("Decision:"))?.split(":", 2)[1]?.trim();
    if (decision === "APPROVE") {
      const issuesNone = content.includes("Issues: none");
      if (!issuesNone) {
        throw new Error("Invalid kodiai response: APPROVE must include 'Issues: none'");
      }
    }

    return wrappedBody;
  }

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
              body: sanitizeDecisionBody(wrapInDetails(body, "kodiai response")),
            });

            onPublish?.();

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
