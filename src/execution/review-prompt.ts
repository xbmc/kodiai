import { sanitizeContent } from "../lib/sanitizer.ts";

/**
 * Build the system prompt for PR auto-review.
 *
 * Instructs Claude to review the diff, post inline comments with suggestion
 * blocks for issues, and do nothing if the PR is clean (silent approval is
 * handled by the calling handler).
 */
export function buildReviewPrompt(context: {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  prAuthor: string;
  baseBranch: string;
  headBranch: string;
  changedFiles: string[];
  customInstructions?: string;
}): string {
  const lines: string[] = [];

  // --- Context header ---
  lines.push(
    `You are reviewing pull request #${context.prNumber} in ${context.owner}/${context.repo}.`,
    "",
    `Title: ${sanitizeContent(context.prTitle)}`,
    `Author: ${context.prAuthor}`,
    `Branches: ${context.headBranch} -> ${context.baseBranch}`,
  );

  // --- PR body ---
  if (context.prBody && context.prBody.trim().length > 0) {
    lines.push("", "PR description:", "---", sanitizeContent(context.prBody.trim()), "---");
  }

  // --- Changed files ---
  lines.push("", "Changed files:");
  for (const file of context.changedFiles) {
    lines.push(`- ${file}`);
  }

  // --- How to read the diff ---
  lines.push(
    "",
    "## Reading the code",
    "",
    `To see the full diff: Bash(git diff origin/${context.baseBranch}...HEAD)`,
    `To see changed files with stats: Bash(git log origin/${context.baseBranch}..HEAD --stat)`,
    "Read the diff carefully before posting any comments.",
  );

  // --- Review instructions ---
  lines.push(
    "",
    "## What to look for",
    "",
    "Review the changes for:",
    "- Bugs and logic errors",
    "- Crash-prone code (null dereferences, unhandled exceptions)",
    "- Security vulnerabilities (injection, auth bypass, data exposure)",
    "- Performance issues (N+1 queries, unbounded loops, memory leaks)",
    "- Resource management issues (unclosed handles, missing cleanup)",
    "- Thread safety and concurrency issues",
    "- Incorrect or missing error handling",
  );

  // --- How to report ---
  lines.push(
    "",
    "## How to report issues",
    "",
    "Use the `mcp__github_inline_comment__create_inline_comment` tool to post inline comments on the specific file and line where the issue occurs.",
    "",
    "When you have a concrete fix, include a GitHub suggestion block in your comment body:",
    "",
    "````",
    "```suggestion",
    "replacement code here",
    "```",
    "````",
    "",
    "The suggestion block replaces the entire line range (from startLine to line). Make sure the replacement is syntactically complete.",
  );

  // --- Rules ---
  lines.push(
    "",
    "## Rules",
    "",
    "- ONLY report actionable issues that need to be fixed",
    '- NO positive feedback, NO "looks good" -- but DO post exactly one summary comment as instructed below',
    "- Use inline comments for ALL code-specific issues",
    "- When listing items, use (1), (2), (3) format -- NEVER #1, #2, #3 (GitHub treats those as issue links)",
    "- Focus on correctness and safety, not style preferences",
  );

  // --- Summary comment ---
  lines.push(
    "",
    "## Summary comment",
    "",
    `FIRST, before posting any inline comments, post ONE summary comment on the PR using the \`mcp__github_comment__create_comment\` tool with issue number ${context.prNumber}.`,
    "",
    "Use this structure:",
    "",
    "### Summary",
    "",
    "**What changed:** [1-3 sentence high-level description of what the PR does]",
    "",
    "**Why:** [Inferred purpose or motivation for the changes]",
    "",
    "**Files modified:**",
    "- `file1.ts` -- [brief description]",
    "- `file2.ts` -- [brief description]",
    "[...list all changed files with one-line descriptions]",
    "",
    "Rules for the summary:",
    "- Keep it concise and factual",
    "- If the PR is trivial (fewer than 3 files, under 50 lines changed), keep the entire summary to 2-3 lines",
    "- If the summary would exceed 500 characters, wrap it in `<details>` tags:",
    "  <details>",
    "  <summary>PR Summary</summary>",
    "",
    "  [summary content]",
    "",
    "  </details>",
    "- Post this summary BEFORE any inline review comments so it appears first in the conversation",
  );

  // --- After review ---
  lines.push(
    "",
    "## After review",
    "",
    "If you found issues: post the summary comment first, then post inline comments using the MCP tool.",
    "If NO issues found: post the summary comment, then do nothing else. Do NOT post any approval -- the system handles silent approval automatically.",
  );

  // --- Custom instructions ---
  if (context.customInstructions) {
    lines.push("", "## Custom instructions", "", context.customInstructions);
  }

  return lines.join("\n");
}
