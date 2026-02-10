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

  function sanitizeKodiaiDecisionResponse(body: string): string {
    // Only enforce structure for the mention decision wrapper.
    if (!body.includes("<summary>kodiai response</summary>")) {
      return body;
    }
    if (!body.includes("Decision:")) {
      return body;
    }

    const lines = body.split("\n");
    const start = lines.findIndex((l) => l.trim() === "<details>");
    const end = lines.findIndex((l) => l.trim() === "</details>");
    const details = start !== -1 && end !== -1 && end > start
      ? lines.slice(start + 1, end)
      : lines;

    const content = details
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0)
      .filter((l) => !l.trim().startsWith("<summary>"));

    const decisionLine = content.find((l) => l.trim().startsWith("Decision:"));
    if (!decisionLine) {
      throw new Error("Invalid kodiai response: missing Decision line");
    }

    const decision = decisionLine.split(":", 2)[1]?.trim();
    if (decision !== "APPROVE" && decision !== "NOT APPROVED") {
      throw new Error("Invalid kodiai response: Decision must be APPROVE or NOT APPROVED");
    }

    if (decision === "APPROVE") {
      const issuesNone = content.find((l) => l.trim() === "Issues: none");
      if (!issuesNone) {
        throw new Error("Invalid kodiai response: APPROVE must include 'Issues: none'");
      }
      // Enforce no other non-empty content besides Decision and Issues: none.
      const allowed = new Set([decisionLine.trim(), "Issues: none"]);
      for (const l of content) {
        if (!allowed.has(l.trim())) {
          throw new Error(
            "Invalid kodiai response: APPROVE must contain only Decision and Issues: none",
          );
        }
      }
      return body;
    }

    // NOT APPROVED: require Issues: header and issue lines.
    const issuesHeaderIndex = content.findIndex((l) => l.trim() === "Issues:");
    if (issuesHeaderIndex === -1) {
      throw new Error("Invalid kodiai response: NOT APPROVED must include 'Issues:'");
    }

    const issueLineRe =
      /^- \(\d+\) \[(critical|major|minor)\] (.+?) \((\d+(?:,\s*\d+)*)\): .+/;
    const issueLines = content.slice(issuesHeaderIndex + 1).filter((l) => l.trim().startsWith("-"));
    if (issueLines.length === 0) {
      throw new Error("Invalid kodiai response: Issues list is empty");
    }
    for (const l of issueLines) {
      if (!issueLineRe.test(l.trim())) {
        throw new Error(
          "Invalid kodiai response issue format. Use: - (1) [critical|major|minor] path/to/file.ts (123, 456): <1-3 sentences>",
        );
      }
    }

    // Enforce no extra prose outside the Decision/Issues block.
    const allowedPrefixes = ["Decision:", "Issues:", "-"];
    for (const l of content) {
      if (l.trim() === "Issues: none") {
        throw new Error("Invalid kodiai response: Issues: none is only valid with APPROVE");
      }
      if (!allowedPrefixes.some((p) => l.trim().startsWith(p))) {
        throw new Error(
          "Invalid kodiai response: include only Decision and Issues (no additional text)",
        );
      }
    }

    return body;
  }

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
              body: maybeStampMarker(
                sanitizeKodiaiReviewSummary(sanitizeKodiaiDecisionResponse(body)),
              ),
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
              body: maybeStampMarker(
                sanitizeKodiaiReviewSummary(sanitizeKodiaiDecisionResponse(body)),
              ),
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
