import { sanitizeContent } from "../lib/sanitizer.ts";

const DEFAULT_MAX_TITLE_CHARS = 200;
const DEFAULT_MAX_PR_BODY_CHARS = 2000;
const DEFAULT_MAX_CHANGED_FILES = 200;

function truncateDeterministic(
  input: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars <= 0) return { text: "", truncated: input.length > 0 };
  if (input.length <= maxChars) return { text: input, truncated: false };
  const clipped = input.slice(0, maxChars).trimEnd();
  return { text: `${clipped}\n...[truncated]`, truncated: true };
}

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
  const scaleNotes: string[] = [];

  const titleSanitized = sanitizeContent(context.prTitle);
  const titleTruncated = truncateDeterministic(titleSanitized, DEFAULT_MAX_TITLE_CHARS);
  if (titleTruncated.truncated) {
    scaleNotes.push(`PR title truncated to ${DEFAULT_MAX_TITLE_CHARS} characters.`);
  }

  const prBodySanitized = sanitizeContent((context.prBody ?? "").trim());
  const prBodyTruncated = truncateDeterministic(prBodySanitized, DEFAULT_MAX_PR_BODY_CHARS);
  if (prBodyTruncated.truncated) {
    scaleNotes.push(`PR description truncated to ${DEFAULT_MAX_PR_BODY_CHARS} characters.`);
  }

  const changedFilesSorted = [...context.changedFiles].sort();
  const changedFilesCapped = changedFilesSorted.slice(0, DEFAULT_MAX_CHANGED_FILES);
  if (changedFilesSorted.length > changedFilesCapped.length) {
    scaleNotes.push(
      `Changed file list capped at ${DEFAULT_MAX_CHANGED_FILES}; omitted ${changedFilesSorted.length - changedFilesCapped.length} more file(s).`,
    );
  }

  // --- Context header ---
  lines.push(
    `You are reviewing pull request #${context.prNumber} in ${context.owner}/${context.repo}.`,
    "",
    `Title: ${titleTruncated.text}`,
    `Author: ${context.prAuthor}`,
    `Branches: ${context.headBranch} -> ${context.baseBranch}`,
  );

  if (scaleNotes.length > 0) {
    lines.push(
      "",
      "## Scale Notes",
      "Some context was omitted due to scale guardrails:",
      ...scaleNotes.map((n) => `- ${n}`),
    );
  }

  // --- PR body ---
  if (prBodySanitized.length > 0) {
    lines.push("", "PR description:", "---", prBodyTruncated.text, "---");
  }

  // --- Changed files ---
  lines.push("", "Changed files:");
  for (const file of changedFilesCapped) {
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
    '- NO positive feedback, NO "looks good"',
    '- Do NOT include sections like "What changed" or any change summary (unless explicitly requested)',
    "- ONLY post a summary comment when you have actionable inline issues to report",
    "- Use inline comments for ALL code-specific issues",
    "- When listing items, use (1), (2), (3) format -- NEVER #1, #2, #3 (GitHub treats those as issue links)",
    "- Focus on correctness and safety, not style preferences",
  );

  // --- Summary comment ---
  lines.push(
    "",
    "## Summary comment",
    "",
    "ONLY post a summary comment if you found actionable issues to report as inline comments.",
    "",
    `If you found issues, FIRST post ONE summary comment using the \`mcp__github_comment__create_comment\` tool with issue number ${context.prNumber}. ALWAYS wrap the summary in \`<details>\` tags:`,
    "",
    "<details>",
    "<summary>Kodiai Review Summary</summary>",
    "",
    "Critical",
    "path/to/file.ts (123, 456): <issue title>",
    "<1-3 sentences explaining impact and why it matters>",
    "",
    "Medium",
    "path/to/file.ts (789): <issue title>",
    "<1-3 sentences explaining impact and why it matters>",
    "",
    "</details>",
    "",
    "Hard requirements for the summary comment:",
    "- MUST be issues-only (no change summary / no 'What changed')",
    "- MUST group issues under severity headings: Critical, Must Fix, Major, Medium, Minor",
    "- Under each severity heading, each issue is 2+ lines:",
    "  - Title line: <path/to/file.ts> (123, 456): <issue title>",
    "  - Explanation line(s): 1-3 sentences",
    "- Do NOT add any other headings (no 'Issues found', no 'Note')",
    "Then post your inline comments on the specific lines.",
    "",
    "If NO issues found: do NOT post any comment. The system handles approval automatically.",
  );

  // --- After review ---
  lines.push(
    "",
    "## After review",
    "",
    "If you found issues: post the summary comment (wrapped in <details>) first, then post inline comments.",
    "If NO issues found: do nothing -- no summary, no comments. The calling code handles silent approval.",
  );

  // --- Custom instructions ---
  if (context.customInstructions) {
    lines.push("", "## Custom instructions", "", context.customInstructions);
  }

  return lines.join("\n");
}
