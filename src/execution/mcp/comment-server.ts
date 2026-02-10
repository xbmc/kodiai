import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { buildReviewOutputMarker } from "../../handlers/review-idempotency.ts";

export function createCommentServer(
  getOctokit: () => Promise<Octokit>,
  owner: string,
  repo: string,
  reviewOutputKey?: string,
  onPublish?: () => void,
) {
  const marker = reviewOutputKey ? buildReviewOutputMarker(reviewOutputKey) : null;

  function sanitizeKodiaiReviewSummary(body: string): string {
    // Only enforce structure for the PR auto-review summary comment.
    if (!body.includes("<summary>Kodiai Review Summary</summary>")) {
      return body;
    }

    // Strip forbidden sections that the user does not want.
    const stripped = body
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        if (t.startsWith("**What changed:**")) return false;
        if (t.startsWith("**Issues found:**")) return false;
        if (t.startsWith("**Note:**")) return false;
        return true;
      })
      .join("\n");

    // Enforce issue bullet format: "- (1) [major] path/to/file.ts (123): ..."
    const lines = stripped.split("\n");
    const inDetailsStart = lines.findIndex((l) => l.trim() === "<details>");
    const inDetailsEnd = lines.findIndex((l) => l.trim() === "</details>");
    const detailsLines =
      inDetailsStart !== -1 && inDetailsEnd !== -1 && inDetailsEnd > inDetailsStart
        ? lines.slice(inDetailsStart, inDetailsEnd + 1)
        : lines;

    const hasStatus = detailsLines.some((l) => l.trim().startsWith("**Status:**"));
    const issuesHeaderIndex = detailsLines.findIndex((l) => l.trim() === "**Issues:**");
    if (!hasStatus || issuesHeaderIndex === -1) {
      throw new Error(
        "Invalid Kodiai review summary: must include **Status:** and **Issues:** only (no other headings).",
      );
    }

    const issueLineRe = /^- \(\d+\) \[(critical|major|minor)\] (\S+) \((\d+)\): .+/;
    for (let i = issuesHeaderIndex + 1; i < detailsLines.length; i++) {
      const line = detailsLines[i]?.trim();
      if (!line) continue;
      if (line === "</details>") break;
      if (!line.startsWith("-")) continue;

      if (!issueLineRe.test(line)) {
        throw new Error(
          "Invalid Kodiai review summary issue format. Use: - (1) [critical|major|minor] path/to/file.ts (123): <1-3 sentences>.",
        );
      }
    }

    return stripped;
  }

  function maybeStampMarker(body: string): string {
    if (!marker) return body;
    if (body.includes(marker)) return body;
    return `${body}\n\n${marker}`;
  }

  return createSdkMcpServer({
    name: "github_comment",
    version: "0.1.0",
    tools: [
      tool(
        "update_comment",
        "Update a GitHub issue or PR comment with new content",
        {
          commentId: z.number().describe("The comment ID to update"),
          body: z.string().describe("The updated comment content (markdown)"),
        },
        async ({ commentId, body }) => {
          try {
            const octokit = await getOctokit();
            await octokit.rest.issues.updateComment({
              owner,
              repo,
              comment_id: commentId,
              body: maybeStampMarker(sanitizeKodiaiReviewSummary(body)),
            });
            onPublish?.();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ success: true, comment_id: commentId }),
                },
              ],
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              isError: true,
            };
          }
        },
      ),
      tool(
        "create_comment",
        "Create a new comment on a GitHub issue or pull request",
        {
          issueNumber: z.number().describe("Issue or PR number"),
          body: z.string().describe("Comment body (markdown)"),
        },
        async ({ issueNumber, body }) => {
          try {
            const octokit = await getOctokit();
            const { data } = await octokit.rest.issues.createComment({
              owner,
              repo,
              issue_number: issueNumber,
              body: maybeStampMarker(sanitizeKodiaiReviewSummary(body)),
            });
            onPublish?.();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ success: true, comment_id: data.id }),
                },
              ],
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
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
