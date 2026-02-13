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
  prNumber?: number,
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

    // Strip forbidden legacy content that should not appear.
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

    // --- Five-section template validation ---

    const requiredSections = ["## What Changed", "## Observations", "## Verdict"];
    const optionalSections = ["## Strengths", "## Suggestions"];
    const canonicalOrder = [
      "## What Changed",
      "## Strengths",
      "## Observations",
      "## Suggestions",
      "## Verdict",
    ];

    // 1. Section presence validation: required sections must exist.
    for (const section of requiredSections) {
      if (!stripped.includes(section)) {
        throw new Error(
          `Invalid Kodiai review summary: missing required section '${section}'`,
        );
      }
    }

    // 2. Section order validation: present sections must appear in canonical order.
    const presentSections = canonicalOrder.filter((s) => stripped.includes(s));
    let lastIndex = -1;
    for (const section of presentSections) {
      const idx = stripped.indexOf(section);
      if (idx < lastIndex) {
        throw new Error(
          "Invalid Kodiai review summary: sections must appear in order (What Changed -> Strengths -> Observations -> Suggestions -> Verdict)",
        );
      }
      lastIndex = idx;
    }

    // 3. No extra top-level headings.
    const allKnownSections = new Set(canonicalOrder);
    const headingRe = /^## .+$/gm;
    let match: RegExpExecArray | null;
    while ((match = headingRe.exec(stripped)) !== null) {
      const heading = match[0].trim();
      if (!allKnownSections.has(heading)) {
        throw new Error(
          `Invalid Kodiai review summary: unexpected section '${heading}'. Only use: What Changed, Strengths, Observations, Suggestions, Verdict`,
        );
      }
    }

    // 4. Verdict format validation.
    const verdictStart = stripped.indexOf("## Verdict");
    const verdictSection = stripped.slice(verdictStart);
    const verdictLineRe =
      /^:(green_circle|yellow_circle|red_circle): \*\*[^*]+\*\* -- .+$/m;
    if (!verdictLineRe.test(verdictSection)) {
      throw new Error(
        "Invalid Kodiai review summary: Verdict must use format ':emoji: **Label** -- explanation'",
      );
    }

    // 5. Observations section validation: must contain ### Impact (required) and ### Preference (optional)
    //    with severity-tagged finding lines: [SEVERITY] path (lines): title
    const observationsStart = stripped.indexOf("## Observations");
    // Find the next ## section after Observations.
    const afterObservations = stripped.slice(
      observationsStart + "## Observations".length,
    );
    const nextSectionMatch = afterObservations.match(/^## /m);
    const observationsContent = nextSectionMatch
      ? afterObservations.slice(0, nextSectionMatch.index)
      : afterObservations;

    const validSubsections = new Set(["### Impact", "### Preference"]);
    const observationsLines = observationsContent.split("\n");
    let foundSubsection = false;

    const lineSpec = "\\d+(?:-\\d+)?(?:,\\s*\\d+(?:-\\d+)?)*";
    const issueLineRe = new RegExp(`^\\[(CRITICAL|MAJOR|MEDIUM|MINOR)\\] (.+?) \\((?:${lineSpec})\\): (.+)$`);

    let currentSubsection: string | undefined;
    // State machine: INTRO | ISSUE | EXPLANATION
    let state: "INTRO" | "ISSUE" | "EXPLANATION" = "INTRO";

    for (const raw of observationsLines) {
      const line = raw.trim();

      // Check for subsection headings first (even on empty lines, trim handles it).
      if (validSubsections.has(line)) {
        if (state === "ISSUE") {
          throw new Error(
            `Invalid Kodiai review summary: missing explanation line after finding in ${currentSubsection ?? "subsection"}.`,
          );
        }
        foundSubsection = true;
        currentSubsection = line;
        state = "INTRO";
        continue;
      }

      // Reject old-style severity sub-headings explicitly.
      if (line === "### Critical" || line === "### Major" || line === "### Medium" || line === "### Minor") {
        // Falls through to the non-conforming line check below since they're not in validSubsections.
        // But handle them explicitly: they are not valid subsections.
      }

      if (!currentSubsection) {
        // Content before any subsection heading -- ignore (could be intro text).
        continue;
      }

      // Strip bold markers for flexible matching: **[CRITICAL]** -> [CRITICAL]
      const stripped_line = line.replace(/\*\*/g, "");

      // Test for severity-tagged issue line.
      const isIssueLine = issueLineRe.test(stripped_line);

      // Extract severity for soft checks.
      const severityMatch = stripped_line.match(/^\[(CRITICAL|MAJOR|MEDIUM|MINOR)\]/);

      if (state === "INTRO") {
        // Allow blank lines in INTRO.
        if (!line) continue;

        if (isIssueLine) {
          // Transition: INTRO -> ISSUE
          state = "ISSUE";
          // Soft check: CRITICAL/MAJOR in Preference.
          if (currentSubsection === "### Preference" && severityMatch) {
            const sev = severityMatch[1];
            if (sev === "CRITICAL" || sev === "MAJOR") {
              console.warn(`Preference finding with ${sev} severity -- expected MEDIUM or MINOR`);
            }
          }
          continue;
        }

        // Allow any non-heading, non-severity-tagged lines as introductory/descriptive text.
        if (line.startsWith("### ")) {
          // Unknown subsection heading -- error.
          throw new Error(
            `Invalid Kodiai review summary: unexpected subsection '${line}' under Observations. Only use: ### Impact, ### Preference`,
          );
        }
        continue;
      }

      if (state === "ISSUE") {
        // The explanation must directly follow -- blank lines are NOT allowed.
        if (!line) {
          throw new Error(
            `Invalid Kodiai review summary: missing explanation line after finding in ${currentSubsection}.`,
          );
        }
        // The next non-empty line is the explanation.
        // But it must not be another issue line or a subsection heading.
        if (isIssueLine) {
          throw new Error(
            `Invalid Kodiai review summary: missing explanation line after finding in ${currentSubsection}.`,
          );
        }
        if (line.startsWith("### ")) {
          throw new Error(
            `Invalid Kodiai review summary: missing explanation line after finding in ${currentSubsection}.`,
          );
        }
        // Valid explanation line.
        state = "EXPLANATION";
        continue;
      }

      if (state === "EXPLANATION") {
        // Blank lines are allowed as separators between finding pairs.
        if (!line) continue;

        // Next severity-tagged issue line -> transition back to ISSUE.
        if (isIssueLine) {
          state = "ISSUE";
          // Soft check: CRITICAL/MAJOR in Preference.
          if (currentSubsection === "### Preference" && severityMatch) {
            const sev = severityMatch[1];
            if (sev === "CRITICAL" || sev === "MAJOR") {
              console.warn(`Preference finding with ${sev} severity -- expected MEDIUM or MINOR`);
            }
          }
          continue;
        }

        // Subsection heading -> will be caught at top of loop on next iteration.
        // Unknown heading check.
        if (line.startsWith("### ")) {
          if (!validSubsections.has(line)) {
            throw new Error(
              `Invalid Kodiai review summary: unexpected subsection '${line}' under Observations. Only use: ### Impact, ### Preference`,
            );
          }
          // This case won't actually reach here because validSubsections check is at top.
        }

        // Non-conforming line after we've entered ISSUE/EXPLANATION alternation.
        // A line that is not blank, not an issue line, and not a heading is a non-conforming line.
        // However, we should tolerate continuation text (multi-line explanations).
        // Treat as extended explanation continuation -- remain in EXPLANATION state.
        continue;
      }
    }

    if (state === "ISSUE") {
      throw new Error(
        `Invalid Kodiai review summary: missing explanation line after finding in ${currentSubsection ?? "subsection"}.`,
      );
    }

    if (!foundSubsection || !stripped.includes("### Impact")) {
      throw new Error(
        "Invalid Kodiai review summary: Observations must contain ### Impact subsection with at least one severity-tagged finding",
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
            const sanitized = maybeStampMarker(
              sanitizeKodiaiReviewSummary(sanitizeKodiaiDecisionResponse(body)),
            );

            const isApproveNoIssues =
              prNumber !== undefined &&
              sanitized.includes("<summary>kodiai response</summary>") &&
              sanitized.includes("Decision: APPROVE") &&
              sanitized.includes("Issues: none");

            if (isApproveNoIssues) {
              await octokit.rest.pulls.createReview({
                owner,
                repo,
                pull_number: prNumber,
                event: "APPROVE",
                body: sanitized,
              });
              onPublish?.();
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({ success: true, approved: true, pull_number: prNumber }),
                  },
                ],
              };
            }

            const { data } = await octokit.rest.issues.createComment({
              owner,
              repo,
              issue_number: issueNumber,
              body: sanitized,
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
