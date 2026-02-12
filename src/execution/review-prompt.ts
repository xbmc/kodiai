import { sanitizeContent } from "../lib/sanitizer.ts";
import picomatch from "picomatch";
import type { DiffAnalysis } from "./diff-analysis.ts";

const DEFAULT_MAX_TITLE_CHARS = 200;
const DEFAULT_MAX_PR_BODY_CHARS = 2000;
const DEFAULT_MAX_CHANGED_FILES = 200;

export interface PathInstruction {
  path: string | string[];
  instructions: string;
}

export interface MatchedInstruction {
  pattern: string | string[];
  instructions: string;
  matchedFiles: string[];
}

export type SuppressionPattern = {
  pattern: string;
  severity?: string[];
  category?: string[];
  paths?: string[];
};

function scanPattern(pattern: string): { negated: boolean; glob: string } {
  const scanner = picomatch as unknown as {
    scan?: (input: string) => { negated?: boolean; glob?: string };
  };
  const result = scanner.scan?.(pattern);
  return {
    negated: Boolean(result?.negated),
    glob: result?.glob ?? pattern.replace(/^!+/, ""),
  };
}

function truncateDeterministic(
  input: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars <= 0) return { text: "", truncated: input.length > 0 };
  if (input.length <= maxChars) return { text: input, truncated: false };
  const clipped = input.slice(0, maxChars).trimEnd();
  return { text: `${clipped}\n...[truncated]`, truncated: true };
}

// ---------------------------------------------------------------------------
// Helper: Severity classification guidelines (always included)
// ---------------------------------------------------------------------------
function buildSeverityClassificationGuidelines(): string {
  return [
    "## Severity Classification Guidelines",
    "",
    "Classify each finding into exactly one severity level:",
    "",
    "**CRITICAL:** SQL injection, XSS, auth bypass, secrets exposure, critical NPE, infinite loops, data corruption.",
    "",
    "**MAJOR:** Unhandled exceptions, missing error handling on external calls, race conditions, resource leaks, incorrect business logic.",
    "",
    "**MEDIUM:** Edge case handling gaps, missing input validation (non-security), suboptimal error messages, moderate performance issues.",
    "",
    "**MINOR:** Unused variables/imports (production code only), duplicate code, magic numbers, missing JSDoc.",
    "",
    "**Path context adjustments:**",
    "- Test files: downgrade findings by one severity level (e.g. MAJOR becomes MEDIUM).",
    "- Config files: only report CRITICAL findings.",
    "- Documentation files: only report factual errors.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Mode-specific comment format instructions
// ---------------------------------------------------------------------------
function buildModeInstructions(mode: "standard" | "enhanced"): string {
  if (mode === "enhanced") {
    return [
      "## Comment Format (Enhanced Mode)",
      "",
      "Each inline comment MUST start with a fenced YAML code block containing structured metadata:",
      "",
      "````",
      "```yaml",
      "severity: CRITICAL | MAJOR | MEDIUM | MINOR",
      "category: security | correctness | performance | error-handling | resource-management | concurrency",
      "suggested_action: fix | consider | investigate",
      "related_docs_url: (optional) https://...",
      "```",
      "````",
      "",
      "After the code block, leave a blank line, then a **bold finding title**, then 1-3 sentences explaining the issue.",
      "Include suggestion blocks when a concrete fix exists.",
    ].join("\n");
  }

  return [
    "## Comment Format (Standard Mode)",
    "",
    "Each inline comment MUST begin with a severity prefix in square brackets: `[CRITICAL]`, `[MAJOR]`, `[MEDIUM]`, or `[MINOR]`.",
    "After the prefix, include finding details and suggestion blocks as normal.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Noise suppression rules (always included)
// ---------------------------------------------------------------------------
function buildNoiseSuppressionRules(): string {
  return [
    "## Noise Suppression",
    "",
    "NEVER flag any of the following:",
    "- Style-only issues",
    "- Trivial renamings",
    "- Cosmetic preferences (import ordering, trailing commas, semicolons, bracket placement)",
    '- "Consider using X instead of Y" when both approaches work',
    "- Documentation wording nits",
    "- Test file organization preferences",
    "",
    "Focus exclusively on: correctness, security, performance, error handling, resource management, concurrency safety.",
    "",
    "If custom instructions below conflict with the noise suppression rules above, follow the custom instructions.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Comment cap instructions
// ---------------------------------------------------------------------------
function buildCommentCapInstructions(maxComments: number): string {
  return [
    "## Comment Limit",
    "",
    `Post at most ${maxComments} inline comments for this PR review.`,
    "Prioritize by severity: CRITICAL first, then MAJOR, MEDIUM, MINOR.",
    "If more issues exist than the limit allows, add a note at the end of your final inline comment:",
    `"Note: Additional lower-severity issues were found but omitted. Increase review.maxComments in .kodiai.yml to see more."`,
    "Do NOT waste comment slots on low-severity findings when higher-severity issues exist.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Severity filter instructions (only when minLevel > minor)
// ---------------------------------------------------------------------------
function buildSeverityFilterInstructions(
  minLevel: "critical" | "major" | "medium" | "minor",
): string {
  if (minLevel === "minor") return "";

  const allLevels: Array<"critical" | "major" | "medium" | "minor"> = [
    "critical",
    "major",
    "medium",
    "minor",
  ];
  const cutoff = allLevels.indexOf(minLevel);
  const activeLevels = allLevels.slice(0, cutoff + 1);

  return [
    "## Severity Filter",
    "",
    `Only report findings at these severity levels: ${activeLevels.join(", ")}.`,
    `Do NOT generate findings below ${minLevel} severity.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Focus area / ignored area instructions
// ---------------------------------------------------------------------------
function buildFocusAreaInstructions(
  focusAreas: string[],
  ignoredAreas: string[],
): string {
  const parts: string[] = [];

  if (focusAreas.length > 0) {
    parts.push(
      `Concentrate your review on these categories: ${focusAreas.join(", ")}. For categories NOT in this list, only report CRITICAL severity findings.`,
    );
  }

  if (ignoredAreas.length > 0) {
    parts.push(
      `Explicitly SKIP these categories unless the finding is CRITICAL: ${ignoredAreas.join(", ")}.`,
    );
  }

  if (parts.length === 0) return "";

  return ["## Focus Areas", "", ...parts].join("\n");
}

export function buildSuppressionRulesSection(
  suppressions: Array<string | SuppressionPattern>,
): string {
  if (suppressions.length === 0) return "";

  const lines: string[] = [
    "## Suppression Rules",
    "",
    "Do not flag findings matching these patterns. Still count suppressed findings mentally for the metrics section.",
    "NEVER suppress findings at CRITICAL severity regardless of suppression patterns.",
    "",
    "Configured suppressions:",
  ];

  for (const suppression of suppressions) {
    if (typeof suppression === "string") {
      lines.push(`- pattern: ${suppression}`);
      continue;
    }

    const filters: string[] = [];
    if (suppression.severity && suppression.severity.length > 0) {
      filters.push(`severity=[${suppression.severity.join(", ")}]`);
    }
    if (suppression.category && suppression.category.length > 0) {
      filters.push(`category=[${suppression.category.join(", ")}]`);
    }
    if (suppression.paths && suppression.paths.length > 0) {
      filters.push(`paths=[${suppression.paths.join(", ")}]`);
    }

    if (filters.length > 0) {
      lines.push(`- pattern: ${suppression.pattern} (${filters.join("; ")})`);
    } else {
      lines.push(`- pattern: ${suppression.pattern}`);
    }
  }

  return lines.join("\n");
}

export function buildConfidenceInstructions(minConfidence: number): string {
  const lines = [
    "## Confidence Display",
    "",
    "Include severity and category metadata for every finding so confidence can be computed post-execution.",
    "Confidence scores are deterministic and derived from severity/category/pattern signals, not self-assessment.",
  ];

  if (minConfidence > 0) {
    lines.push(
      `Findings below ${minConfidence}% confidence will be shown in a separate collapsible section.`,
    );
  }

  return lines.join("\n");
}

export function buildMetricsInstructions(): string {
  return [
    "## Review Metrics",
    "",
    "Categorize findings consistently by severity so review metrics can be computed from files reviewed, lines changed, and finding counts.",
  ].join("\n");
}

export function matchPathInstructions(
  pathInstructions: PathInstruction[],
  changedFiles: string[],
): MatchedInstruction[] {
  const results: MatchedInstruction[] = [];

  for (const entry of pathInstructions) {
    const patterns = Array.isArray(entry.path) ? entry.path : [entry.path];
    const includePatterns: string[] = [];
    const excludePatterns: string[] = [];

    for (const rawPattern of patterns) {
      const pattern = rawPattern.trim();
      if (!pattern) {
        continue;
      }

      const scanned = scanPattern(pattern);
      if (scanned.negated) {
        excludePatterns.push(scanned.glob || pattern.replace(/^!+/, ""));
      } else {
        includePatterns.push(pattern);
      }
    }

    const includeMatchers = includePatterns.length > 0
      ? includePatterns.map((pattern) => picomatch(pattern, { dot: true }))
      : [() => true];
    const excludeMatchers = excludePatterns.map((pattern) =>
      picomatch(pattern, { dot: true })
    );

    const matchedFiles = changedFiles.filter((file) => {
      const included = includeMatchers.some((matcher) => matcher(file));
      const excluded = excludeMatchers.some((matcher) => matcher(file));
      return included && !excluded;
    });

    if (matchedFiles.length > 0) {
      results.push({
        pattern: entry.path,
        instructions: entry.instructions,
        matchedFiles,
      });
    }
  }

  return results;
}

function patternSpecificity(pattern: string | string[]): number {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  return patterns.reduce((score, part) => {
    const wildcardPenalty = (part.match(/[\*\?\[\]{}]/g) ?? []).length * 5;
    return score + Math.max(0, part.length - wildcardPenalty);
  }, 0);
}

export function buildPathInstructionsSection(
  matched: MatchedInstruction[],
  maxChars: number = 3000,
): string {
  if (matched.length === 0 || maxChars <= 0) {
    return "";
  }

  const header = "## Path-Specific Review Instructions";
  const truncationNote =
    "_Note: Additional path instructions were truncated due to prompt size limits._";
  const reservedForNote = truncationNote.length + 2;
  const effectiveMaxChars = Math.max(0, maxChars - reservedForNote);
  let section = `${header}\n\n`;
  let truncated = false;

  const prioritized = matched
    .map((entry, index) => ({
      entry,
      index,
      score: entry.matchedFiles.length * 1000 + patternSpecificity(entry.pattern),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ entry }) => entry);

  for (const item of prioritized) {
    const patternText = Array.isArray(item.pattern)
      ? item.pattern.join(", ")
      : item.pattern;
    const displayFiles = item.matchedFiles.slice(0, 5);
    const extraCount = item.matchedFiles.length - displayFiles.length;
    const filesText = extraCount > 0
      ? `${displayFiles.join(", ")} (and ${extraCount} more)`
      : displayFiles.join(", ");
    const patternLabel = patternText.endsWith("**")
      ? `**${patternText}`
      : `**${patternText}**`;
    const block = `${patternLabel} (applies to: ${filesText})\n${item.instructions.trim()}\n\n`;

    if (section.length + block.length > effectiveMaxChars) {
      truncated = true;
      break;
    }

    section += block;
  }

  if (truncated) {
    if (section.length + truncationNote.length + 2 <= maxChars) {
      section += `${truncationNote}\n`;
    }
  }

  return section.trimEnd();
}

export function buildDiffAnalysisSection(analysis: DiffAnalysis): string {
  if (analysis.metrics.totalFiles === 0) {
    return "";
  }

  const lines: string[] = ["## Change Context", ""];
  const hunkSuffix = analysis.metrics.hunksCount > 0
    ? ` across ${analysis.metrics.hunksCount} hunks`
    : "";
  lines.push(
    `This PR modifies ${analysis.metrics.totalFiles} files (+${analysis.metrics.totalLinesAdded} / -${analysis.metrics.totalLinesRemoved} lines)${hunkSuffix}.`,
  );

  if (analysis.isLargePR) {
    lines.push("", "This is a large PR. Focus on the most critical changes.");
  }

  const categorized = Object.entries(analysis.filesByCategory).filter(([, files]) =>
    files.length > 0
  );
  if (categorized.length > 0) {
    lines.push("", "File breakdown:");
    for (const [category, files] of categorized) {
      lines.push(`- ${category}: ${files.length} file(s)`);
    }
  }

  if (analysis.riskSignals.length > 0) {
    lines.push("", "Pay special attention to these areas:");
    for (const riskSignal of analysis.riskSignals) {
      lines.push(`- ${riskSignal}`);
    }
  }

  return lines.join("\n");
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
  // Review mode & severity control fields
  mode?: "standard" | "enhanced";
  severityMinLevel?: "critical" | "major" | "medium" | "minor";
  focusAreas?: string[];
  ignoredAreas?: string[];
  maxComments?: number;
  suppressions?: Array<string | SuppressionPattern>;
  minConfidence?: number;
  diffAnalysis?: DiffAnalysis;
  matchedPathInstructions?: MatchedInstruction[];
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

  const diffAnalysisSection = context.diffAnalysis
    ? buildDiffAnalysisSection(context.diffAnalysis)
    : "";
  if (diffAnalysisSection) {
    lines.push("", diffAnalysisSection);
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

  // --- Severity classification ---
  lines.push("", buildSeverityClassificationGuidelines());

  // --- Review mode format ---
  lines.push("", buildModeInstructions(context.mode ?? "standard"));

  // --- Noise suppression ---
  lines.push("", buildNoiseSuppressionRules());

  // --- Path instructions ---
  const pathInstructionsSection = buildPathInstructionsSection(
    context.matchedPathInstructions ?? [],
  );
  if (pathInstructionsSection) lines.push("", pathInstructionsSection);

  // --- Comment cap ---
  lines.push("", buildCommentCapInstructions(context.maxComments ?? 7));

  // --- Severity filter ---
  const severityFilter = buildSeverityFilterInstructions(
    context.severityMinLevel ?? "minor",
  );
  if (severityFilter) lines.push("", severityFilter);

  // --- Focus areas ---
  const focusInstructions = buildFocusAreaInstructions(
    context.focusAreas ?? [],
    context.ignoredAreas ?? [],
  );
  if (focusInstructions) lines.push("", focusInstructions);

  const mode = context.mode ?? "standard";

  const suppressionRulesSection = buildSuppressionRulesSection(
    context.suppressions ?? [],
  );
  if (suppressionRulesSection) {
    lines.push("", suppressionRulesSection);
  }

  lines.push("", buildConfidenceInstructions(context.minConfidence ?? 0));
  if (mode === "enhanced") {
    lines.push("", buildMetricsInstructions());
  }

  // --- Summary comment ---
  if (mode === "enhanced") {
    lines.push(
      "",
      "## Summary comment",
      "",
      "Do NOT post a top-level summary comment. Each inline comment stands alone with its own severity and category metadata.",
      "If NO issues found: do nothing.",
    );
  } else {
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
  }

  // --- After review ---
  if (mode === "enhanced") {
    lines.push(
      "",
      "## After review",
      "",
      "If you found issues: post inline comments only (no summary comment).",
      "If NO issues found: do nothing.",
    );
  } else {
    lines.push(
      "",
      "## After review",
      "",
      "If you found issues: post the summary comment (wrapped in <details>) first, then post inline comments.",
      "If NO issues found: do nothing -- no summary, no comments. The calling code handles silent approval.",
    );
  }

  // --- Custom instructions ---
  if (context.customInstructions) {
    lines.push("", "## Custom instructions", "", context.customInstructions);
  }

  return lines.join("\n");
}
