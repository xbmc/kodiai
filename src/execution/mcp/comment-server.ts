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
        if (t.toLowerCase().startsWith("what changed:")) return false;
        if (t.startsWith("**Issues found:**")) return false;
        if (t.startsWith("**Note:**")) return false;
        return true;
      })
      .join("\n");

    // Enforce review summary issue format.
    // Preferred format:
    //
    //   Critical
    //   path/to/file.ts (12, 34): Issue title
    //   1-3 sentence explanation...
    const lines = stripped.split("\n");
    const inDetailsStart = lines.findIndex((l) => l.trim() === "<details>");
    const inDetailsEnd = lines.findIndex((l) => l.trim() === "</details>");
    const detailsLines =
      inDetailsStart !== -1 && inDetailsEnd !== -1 && inDetailsEnd > inDetailsStart
        ? lines.slice(inDetailsStart, inDetailsEnd + 1)
        : lines;

    const severityHeadings = new Set(["Critical", "Must Fix", "Major", "Medium", "Minor"]);

    for (const l of detailsLines) {
      const t = (l ?? "").trim();
      if (t.startsWith("Status:") || t.startsWith("**Status:**")) {
        throw new Error(
          "Invalid Kodiai review summary: do not include a Status line; use severity headings only.",
        );
      }
      if (t.startsWith("**Issues:**") || t.startsWith("Issues:")) {
        throw new Error(
          "Invalid Kodiai review summary: do not include an Issues header; use severity headings only.",
        );
      }
    }

    const lineSpec = "\\d+(?:-\\d+)?(?:,\\s*\\d+(?:-\\d+)?)*";
    const issueLineRe = new RegExp(`^(.+?) \\((?:${lineSpec})\\): (.+)$`);

    let sawAnyIssue = false;
    let currentSeverity: string | undefined;
    let expectingIssueLine = false;
    let expectingExplanation = false;

    for (let i = 0; i < detailsLines.length; i++) {
      const raw = detailsLines[i] ?? "";
      const line = raw.trim();
      if (!line) continue;
      if (line === "<details>" || line.startsWith("<summary")) continue;
      if (line === "</details>") break;

      if (severityHeadings.has(line)) {
        currentSeverity = line;
        expectingIssueLine = true;
        expectingExplanation = false;
        continue;
      }

      if (!currentSeverity) {
        throw new Error(
          "Invalid Kodiai review summary: issues must be grouped under a severity heading.",
        );
      }

      if (expectingExplanation) {
        // Require at least one explanation line per issue.
        if (severityHeadings.has(line) || issueLineRe.test(line)) {
          throw new Error(
            `Invalid Kodiai review summary: missing explanation line under ${currentSeverity}.`,
          );
        }
        expectingExplanation = false;
        expectingIssueLine = false;
        continue;
      }

      if (expectingIssueLine) {
        if (!issueLineRe.test(line)) {
          throw new Error(
            `Invalid issue line under ${currentSeverity}. Expected: path/to/file.ts (123, 456): Issue title`,
          );
        }
        sawAnyIssue = true;
        expectingExplanation = true;
        continue;
      }

      // If we see another issue line without a new heading, allow it (same severity).
      if (issueLineRe.test(line)) {
        sawAnyIssue = true;
        expectingExplanation = true;
        continue;
      }

      // Otherwise treat it as explanation continuation.
    }

    if (expectingExplanation) {
      throw new Error(
        `Invalid Kodiai review summary: missing explanation line under ${currentSeverity ?? "severity"}.`,
      );
    }

    if (!sawAnyIssue) {
      throw new Error(
        "Invalid Kodiai review summary: expected at least one issue under a severity heading.",
      );
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
