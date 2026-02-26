import { sanitizeContent } from "../lib/sanitizer.ts";
import picomatch from "picomatch";
import type { DiffAnalysis } from "./diff-analysis.ts";
import type { PriorFinding } from "../knowledge/types.ts";
import type { ReviewCommentMatch } from "../knowledge/review-comment-retrieval.ts";
import type { WikiKnowledgeMatch } from "../knowledge/wiki-retrieval.ts";
import type { ClusterPatternMatch } from "../knowledge/cluster-types.ts";
import type { ConventionalCommitType } from "../lib/pr-intent-parser.ts";
import type { AuthorTier } from "../lib/author-classifier.ts";
import type { DepBumpContext } from "../lib/dep-bump-detector.ts";
import type { SecurityContext, ChangelogContext } from "../lib/dep-bump-enrichment.ts";
import type { MergeConfidenceLevel } from "../lib/merge-confidence.ts";

const DEFAULT_MAX_TITLE_CHARS = 200;
const DEFAULT_MAX_PR_BODY_CHARS = 2000;
const DEFAULT_MAX_CHANGED_FILES = 200;
const MAX_LANGUAGE_GUIDANCE_ENTRIES = 5;
export const SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE = "Analysis is partial due to API limits.";

// ---------------------------------------------------------------------------
// Language-specific review guidance (supplements base review rules)
// ---------------------------------------------------------------------------
export const LANGUAGE_GUIDANCE: Record<string, string[]> = {
  Python: [
    "Mutable default arguments in function signatures (e.g., `def fn(x=[])`) -- use `None` and initialize inside the body.",
    "Context managers (`with` statements) for resource handling -- file handles, DB connections, locks.",
    "Bare `except:` clauses -- prefer specific exception types to avoid silencing unexpected errors.",
    "Type hint consistency when annotations are present -- partial annotations are worse than none.",
  ],
  Go: [
    "Unchecked error returns -- no `_` discards without justification comment.",
    "Goroutine leak risk -- ensure channels are closed or contexts are cancelled.",
    "`sync.Mutex` without corresponding `defer Unlock()` -- risk of deadlock on panic.",
    "Nil pointer dereference on interface type assertions without `ok` check.",
  ],
  Rust: [
    "Unnecessary `.unwrap()` on `Result`/`Option` -- prefer `?`, `unwrap_or`, or explicit match.",
    "`unsafe` blocks without `// SAFETY:` comments explaining the invariant.",
    "Overly restrictive lifetime annotations that prevent valid borrow patterns.",
  ],
  Java: [
    "Unclosed resources -- verify `try-with-resources` or explicit `.close()` in `finally`.",
    "Checked exceptions swallowed silently (empty catch blocks) -- at minimum log the error.",
    "Mutable shared state without synchronization -- risk of data races in concurrent code.",
  ],
  "C++": [
    "Raw pointer ownership without RAII or smart pointers (`unique_ptr`/`shared_ptr`).",
    "Missing virtual destructor on base classes with virtual methods -- causes undefined behavior on delete.",
    "Buffer overflow risk in array/pointer arithmetic -- prefer bounds-checked containers.",
  ],
  C: [
    "Buffer overflow risk from unchecked array indexing or string operations (`strcpy`, `sprintf`).",
    "Memory leaks -- `malloc`/`calloc` without matching `free` on all code paths.",
    "Null pointer dereference -- check return values before use (especially from `malloc`, `fopen`).",
  ],
  Ruby: [
    "Missing safe navigation operator (`&.`) for nil-prone method chains.",
    "Open `rescue` clauses (`rescue => e`) -- prefer specific exception types (e.g., `rescue ActiveRecord::RecordNotFound`).",
  ],
  PHP: [
    "SQL injection via string concatenation instead of prepared statements / parameter binding.",
    "Missing type declarations in function signatures (PHP 8+) -- use union types and return types.",
    "Unchecked return values from file/network operations (`fopen`, `curl_exec`).",
  ],
  Swift: [
    "Force unwrapping (`!`) without prior `guard let` / `if let` -- crashes on nil at runtime.",
    "Retain cycles in closures -- missing `[weak self]` or `[unowned self]` capture list.",
  ],
};

export type DeltaReviewContext = {
  lastReviewedHeadSha: string;
  changedFilesSinceLastReview: string[];
  priorFindings: Array<{
    filePath: string;
    title: string;
    severity: string;
    category: string;
  }>;
};

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
// Helper: PR intent scoping section (FORMAT-07)
// ---------------------------------------------------------------------------
export function buildPrIntentScopingSection(
  prTitle: string,
  prLabels: string[],
  headBranch: string,
): string {
  const lines = [
    "## PR Intent Scoping",
    "",
    "Before classifying findings, identify this PR's primary intent from:",
    "- Title and description",
  ];

  if (prLabels.length > 0) {
    lines.push(`- Labels (if present): ${prLabels.join(", ")}`);
  }

  lines.push(
    `- Branch: ${headBranch}`,
    "",
    "Scope findings to the PR's stated intent:",
    "- CI/test fix: Focus on test reliability and correctness. Style issues go to Preference only.",
    "- Performance: Focus on resource usage, complexity. Documentation issues go to Preference only.",
    "- Refactor: Focus on behavior preservation. Note \"preserves existing behavior\" for safe changes.",
    "- Bug fix: Focus on fix correctness, edge cases. Unrelated style goes to Preference only.",
    "- Feature: Full review scope -- all categories apply.",
    "",
    "Findings outside the PR's intent belong in Preference unless CRITICAL severity.",
    "Do NOT judge a narrowly-scoped PR against an imagined ideal version of the code.",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Tone and language guidelines section (FORMAT-08, FORMAT-17, FORMAT-18)
// ---------------------------------------------------------------------------
export function buildToneGuidelinesSection(): string {
  return [
    "## Finding Language Guidelines",
    "",
    "Every finding must be specific about WHAT happens, WHEN it happens, and WHY it matters.",
    "",
    "Use concrete language:",
    "- \"causes [specific issue] when [specific condition]\"",
    "- \"[CRITICAL] Null pointer dereference when `user` is undefined\"",
    "- \"Optional: Extract `retryWithBackoff()` to reduce duplication\"",
    "",
    "Do NOT use hedged or vague language:",
    "- \"could potentially cause issues\"",
    "- \"consider refactoring\"",
    "- \"this might have problems\"",
    "- \"there may be an issue here\"",
    "",
    "For low-risk changes, use stabilizing language:",
    "- \"preserves existing behavior\" -- for refactors that don't change output",
    "- \"backward compatible\" -- for API changes that don't break callers",
    "- \"minimal impact\" -- for changes with small blast radius",
    "",
    "Prefix Preference findings with \"Optional:\" to signal they are non-blocking.",
  ].join("\n");
}

export function buildAuthorExperienceSection(params: {
  tier: AuthorTier;
  authorLogin: string;
  areaExpertise?: { dimension: string; topic: string; score: number }[];
}): string {
  const { tier, authorLogin, areaExpertise } = params;

  // Newcomer prompt (first-time and newcomer tiers)
  if (tier === "first-time" || tier === "newcomer") {
    return [
      "## Author Experience Context",
      "",
      `The PR author (${authorLogin}) appears to be a first-time or new contributor to this repository.`,
      "",
      "Adapt your review tone accordingly:",
      "- Use encouraging, welcoming language",
      "- Explain WHY each finding matters, not just WHAT is wrong",
      "- Link to relevant documentation or examples when suggesting fixes",
      "- Frame suggestions as learning opportunities rather than corrections",
      "- Acknowledge what was done well before noting issues",
      "- Use phrases like \"A common pattern here is...\" instead of \"You should...\"",
      "- For MINOR findings, prefer a brief explanation over terse labels",
      "- When suggesting fixes, include a brief code example if the pattern might be unfamiliar",
    ].join("\n");
  }

  // Developing prompt (regular and developing tiers)
  if (tier === "regular" || tier === "developing") {
    return [
      "## Author Experience Context",
      "",
      `The PR author (${authorLogin}) is a developing contributor with growing familiarity in this area.`,
      "",
      "- Provide moderate explanation — mention WHY for non-obvious issues, skip for basic ones",
      "- Include doc links for project-specific patterns but not general language features",
      "- Use a balanced, collaborative tone",
      "- Comment on both style concerns and substantive issues",
    ].join("\n");
  }

  // Established prompt
  if (tier === "established") {
    return [
      "## Author Experience Context",
      "",
      `The PR author (${authorLogin}) is an established contributor.`,
      "",
      "- Keep explanations brief — one sentence on WHY, then the suggestion",
      "- Skip style-only nitpicks unless they violate project conventions",
      "- Focus on correctness and maintainability over pedagogy",
    ].join("\n");
  }

  // Senior prompt (core and senior tiers)
  if (tier === "core" || tier === "senior") {
    const lines = [
      "## Author Experience Context",
      "",
      `The PR author (${authorLogin}) is a core/senior contributor of this repository.`,
      "",
      "Adapt your review tone accordingly:",
      "- Be concise and assume familiarity with the codebase",
      "- Skip explanations of well-known patterns; focus on the specific issue",
      "- Use terse finding descriptions (issue + consequence only)",
      "- Omit links to basic documentation",
      "- For MINOR findings, a one-liner is sufficient",
      "- Focus on architecture and design, not syntax or style",
      "- Use peer-to-peer tone: direct, brief, no hedging",
    ];

    // Add expertise context if author has deep expertise in relevant areas
    if (areaExpertise && areaExpertise.length > 0) {
      const strongAreas = areaExpertise.filter((e) => e.score >= 0.7);
      if (strongAreas.length > 0) {
        const topics = strongAreas.map((e) => `${e.topic}`).join(", ");
        lines.push(
          `- The author has deep expertise in ${topics}. Only flag issues you're highly confident about.`,
        );
      }
    }

    return lines.join("\n");
  }

  return "";
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

// ---------------------------------------------------------------------------
// Helper: Large PR triage section builder (FORMAT-40)
// ---------------------------------------------------------------------------
export function buildLargePRTriageSection(params: {
  fullReviewFiles: string[];
  abbreviatedFiles: string[];
  mentionOnlyCount: number;
  totalFiles: number;
}): string {
  const { fullReviewFiles, abbreviatedFiles, mentionOnlyCount, totalFiles } = params;

  const lines: string[] = [
    "## Large PR Triage",
    "",
    `This PR contains ${totalFiles} files. Files have been prioritized by risk score for efficient review.`,
    "",
  ];

  if (fullReviewFiles.length > 0) {
    lines.push(
      `### Full Review (${fullReviewFiles.length} files)`,
      "",
      "Review these files thoroughly for all issue categories:",
    );
    for (const file of fullReviewFiles) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  if (abbreviatedFiles.length > 0) {
    lines.push(
      `### Abbreviated Review (${abbreviatedFiles.length} files)`,
      "",
      "For these files, ONLY flag CRITICAL and MAJOR issues. Skip MEDIUM and MINOR findings.",
    );
    for (const file of abbreviatedFiles) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  if (mentionOnlyCount > 0) {
    lines.push(
      `${mentionOnlyCount} additional file(s) were not included for review (lower risk score).`,
    );
  }

  return lines.join("\n").trimEnd();
}

export function buildDiffAnalysisSection(analysis: DiffAnalysis, options?: { suppressLargePRMessage?: boolean }): string {
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

  if (analysis.isLargePR && !options?.suppressLargePRMessage) {
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

// ---------------------------------------------------------------------------
// Helper: Reviewed categories line for summary template (FORMAT-02)
// ---------------------------------------------------------------------------
const CATEGORY_LABELS: Record<string, string> = {
  source: "core logic",
  test: "tests",
  config: "config",
  docs: "docs",
  infra: "infrastructure",
};

export function buildReviewedCategoriesLine(
  filesByCategory: Record<string, string[]>,
): string {
  const reviewed = Object.entries(filesByCategory)
    .filter(([, files]) => files.length > 0)
    .map(([category]) => CATEGORY_LABELS[category] ?? category);

  if (reviewed.length === 0) return "";
  return `Reviewed: ${reviewed.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Helper: Verdict Logic section (FORMAT-03, Phase 36)
// ---------------------------------------------------------------------------
export function buildVerdictLogicSection(): string {
  return [
    "## Verdict Logic",
    "",
    'A "blocker" is any finding with severity CRITICAL or MAJOR under ### Impact.',
    "",
    "Determining the verdict:",
    "1. Count the number of [CRITICAL] and [MAJOR] findings under ### Impact.",
    "2. If count > 0: use :red_circle: **Address before merging** -- [count] blocking issue(s) found",
    "3. If count == 0 AND there are non-blocking findings (MEDIUM, MINOR, Preference items, or Suggestions): use :yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below",
    "4. If count == 0 AND there are no findings at all: use :green_circle: **Ready to merge** -- No blocking issues found",
    "",
    "Suggestions (## Suggestions section) are NEVER counted as blockers.",
    "MEDIUM and MINOR findings are NOT blockers. They produce :yellow_circle: at most.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Incremental review context section
// ---------------------------------------------------------------------------
export function buildIncrementalReviewSection(params: {
  lastReviewedHeadSha: string;
  changedFilesSinceLastReview: string[];
  unresolvedPriorFindings: PriorFinding[];
}): string {
  const sha7 = params.lastReviewedHeadSha.slice(0, 7);
  const files = params.changedFilesSinceLastReview.slice(0, 50);
  const lines: string[] = [
    "## Incremental Review Mode",
    "",
    `This is an incremental re-review. The last review covered commit ${sha7}. Focus ONLY on changes in these ${files.length} files:`,
  ];

  for (const file of files) {
    lines.push(`- ${file}`);
  }
  if (params.changedFilesSinceLastReview.length > 50) {
    lines.push(`- ...(${params.changedFilesSinceLastReview.length - 50} more files omitted)`);
  }

  if (params.unresolvedPriorFindings.length > 0) {
    lines.push(
      "",
      "### Unresolved Prior Findings (Context Only)",
      "",
      "These findings from the prior review are on unchanged code and remain relevant. Do NOT re-comment on them. They are shown for context only.",
      "",
    );
    const capped = params.unresolvedPriorFindings.slice(0, 10);
    for (const finding of capped) {
      lines.push(`- [${finding.severity}] ${finding.title} (${finding.filePath})`);
    }
    if (params.unresolvedPriorFindings.length > 10) {
      lines.push(`- ...(${params.unresolvedPriorFindings.length - 10} more findings omitted)`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Delta review context section (FORMAT-14)
// ---------------------------------------------------------------------------
export function buildDeltaReviewContext(params: {
  lastReviewedHeadSha: string;
  changedFilesSinceLastReview: string[];
  priorFindings: DeltaReviewContext["priorFindings"];
}): string {
  const sha7 = params.lastReviewedHeadSha.slice(0, 7);
  const lines: string[] = [
    "## Delta Review Context",
    "",
    `This is an incremental re-review. The last review covered commit ${sha7}.`,
    "",
    `### Files changed since last review (${params.changedFilesSinceLastReview.length}):`,
  ];

  const capped = params.changedFilesSinceLastReview.slice(0, 50);
  for (const file of capped) {
    lines.push(`- ${file}`);
  }
  if (params.changedFilesSinceLastReview.length > 50) {
    lines.push(`- ...(${params.changedFilesSinceLastReview.length - 50} more)`);
  }

  if (params.priorFindings.length > 0) {
    lines.push(
      "",
      `### Prior review findings (${params.priorFindings.length}):`,
      "",
      "Compare your current findings against these. Classify each as:",
      "- **NEW**: found now but not in the prior list",
      "- **RESOLVED**: was in the prior list but no longer applies",
      "- **STILL OPEN**: was in the prior list and still applies",
      "",
    );
    const cappedFindings = params.priorFindings.slice(0, 30);
    for (const f of cappedFindings) {
      lines.push(`- [${f.severity.toUpperCase()}] ${f.filePath}: ${f.title}`);
    }
    if (params.priorFindings.length > 30) {
      lines.push(`- ...(${params.priorFindings.length - 30} more findings omitted)`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Delta verdict logic section (FORMAT-15)
// ---------------------------------------------------------------------------
export function buildDeltaVerdictLogicSection(): string {
  return [
    "## Verdict Update Logic",
    "",
    "The delta verdict describes the TRANSITION from the previous review, not the absolute state.",
    "",
    "Determining the verdict update:",
    "1. Count new [CRITICAL] and [MAJOR] findings in ## New Findings.",
    "2. If new blockers > 0: use :yellow_circle: **New blockers found** -- Address [N] new issue(s)",
    "3. If new blockers == 0 AND prior blockers were resolved (## Resolved Findings contains CRITICAL/MAJOR): use :green_circle: **Blockers resolved** -- Ready to merge",
    "4. If new blockers == 0 AND no prior blockers were resolved (or no prior blockers existed): use :large_blue_circle: **Still ready** -- No new issues",
    "",
    "Use :green_circle: specifically when the situation IMPROVED (blockers went away).",
    "Use :large_blue_circle: when the situation is UNCHANGED (was good, still good).",
    "Use :yellow_circle: when the situation WORSENED (new blockers appeared).",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Retrieval context section (learning memory)
// ---------------------------------------------------------------------------
export function buildRetrievalContextSection(params: {
  findings: Array<{
    findingText: string;
    severity: string;
    category: string;
    path: string;
    line?: number;
    snippet?: string;
    outcome: string;
    distance: number;
    sourceRepo: string;
  }>;
  maxChars?: number;
  maxItems?: number;
}): string {
  if (params.findings.length === 0) return "";

  const maxChars = params.maxChars ?? 2000;
  const maxItems = params.maxItems ?? params.findings.length;
  if (maxChars <= 0 || maxItems <= 0) return "";

  const sorted = [...params.findings]
    .sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      if (a.path !== b.path) {
        return a.path.localeCompare(b.path);
      }
      return (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, maxItems);

  const renderFinding = (finding: (typeof sorted)[number]): string => {
    const safeSnippet = finding.snippet?.replace(/`/g, "'").trim();
    const safeFindingText = finding.findingText.replace(/`/g, "'").trim();
    if (finding.line !== undefined && safeSnippet) {
      const anchor = `${finding.path}:${finding.line}`;
      return `- [${finding.severity}/${finding.category}] \`${anchor}\` -- \`${safeSnippet}\` (outcome: ${finding.outcome})`;
    }

    return `- [${finding.severity}/${finding.category}] \`${finding.path}\` -- ${safeFindingText} (outcome: ${finding.outcome})`;
  };

  const candidateItems = sorted.map(renderFinding);
  const headerLines: string[] = [
    "## Similar Prior Findings (Learning Context)",
    "",
    "Use these prior findings as supporting context only when they match the current change.",
    "",
    "When a finding directly matches prior context, append:",
    "`(Prior pattern: [brief description])`",
    "",
  ];

  const keptItems = [...candidateItems];
  while (keptItems.length > 0) {
    const section = [...headerLines, ...keptItems].join("\n");
    if (section.length <= maxChars) {
      return section;
    }
    keptItems.pop();
  }

  return "";
}

// ---------------------------------------------------------------------------
// Helper: Review precedents section (KI-05/KI-06)
// ---------------------------------------------------------------------------

const MAX_REVIEW_PRECEDENTS = 5;
const MAX_EXCERPT_CHARS = 200;

/**
 * Truncate text to a maximum number of characters, ending at a word boundary.
 */
function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.5) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

/**
 * Format review comment matches as a prompt section with inline citation instructions.
 * Returns empty string when no matches exist (no section noise).
 */
export function formatReviewPrecedents(matches: ReviewCommentMatch[]): string {
  if (matches.length === 0) return "";

  const sorted = [...matches].sort((a, b) => a.distance - b.distance);
  const capped = sorted.slice(0, MAX_REVIEW_PRECEDENTS);

  const bullets: string[] = [];
  for (const match of capped) {
    const date = match.githubCreatedAt.slice(0, 10); // YYYY-MM-DD
    const location = match.filePath
      ? match.startLine && match.endLine
        ? `\`${match.filePath}:${match.startLine}-${match.endLine}\``
        : `\`${match.filePath}\``
      : "general review";
    const excerpt = truncateAtWordBoundary(
      match.chunkText.replace(/\n/g, " ").trim(),
      MAX_EXCERPT_CHARS,
    );

    bullets.push(
      `- **PR #${match.prNumber}** (@${match.authorLogin}, ${date}) on ${location}:\n  "${excerpt}"`,
    );
  }

  return [
    "## Human Review Precedents",
    "",
    "The following are relevant comments from past human code reviews. Reference them when",
    "the current change exhibits a similar pattern. Cite with:",
    "`(reviewers have previously flagged this pattern -- PR #1234, @author)`",
    "",
    "Only cite when there is a strong match. Do not force citations.",
    "",
    "---",
    ...bullets,
    "---",
  ].join("\n");
}

const MAX_CLUSTER_PATTERNS = 3;
const MAX_CLUSTER_SAMPLE_CHARS = 150;

/**
 * Format cluster pattern matches as subtle footnote-style annotations for review comments.
 * Returns empty string when no matches exist (no section noise).
 *
 * Patterns appear as inline footnote annotations. The LLM is instructed to
 * append these as footnotes to relevant review comments.
 */
export function formatClusterPatterns(patterns: ClusterPatternMatch[]): string {
  if (patterns.length === 0) return "";

  const capped = patterns.slice(0, MAX_CLUSTER_PATTERNS);

  const bullets: string[] = [];
  for (const p of capped) {
    const sample = truncateAtWordBoundary(
      p.representativeSample.replace(/\n/g, " ").trim(),
      MAX_CLUSTER_SAMPLE_CHARS,
    );
    bullets.push(
      `- **${p.slug}**: ${p.label} (${p.memberCount} occurrences in last 60 days)\n  Example: "${sample}"`,
    );
  }

  return [
    "## Recurring Review Patterns",
    "",
    "The following patterns have been identified from historical code reviews on this codebase.",
    "When your review findings align with one of these patterns, append a subtle footnote:",
    '`*(Recurring pattern: [slug] — seen N times in last 60 days)*`',
    "",
    "Add the footnote at the END of your review comment, not as a separate comment.",
    "Only add footnotes when there is a strong match. Max 3 pattern footnotes per review.",
    "Proactively flag code areas matching these patterns even if you would not otherwise comment.",
    "",
    "---",
    ...bullets,
    "---",
  ].join("\n");
}

const MAX_WIKI_KNOWLEDGE = 5;
const MAX_WIKI_EXCERPT_CHARS = 200;

/**
 * Format wiki knowledge matches as a prompt section with inline citation instructions.
 * Returns empty string when no matches exist (no section noise).
 */
export function formatWikiKnowledge(matches: WikiKnowledgeMatch[]): string {
  if (matches.length === 0) return "";

  const sorted = [...matches].sort((a, b) => a.distance - b.distance);
  const capped = sorted.slice(0, MAX_WIKI_KNOWLEDGE);

  const bullets: string[] = [];
  for (const match of capped) {
    const label = match.sectionHeading
      ? `${match.pageTitle} > ${match.sectionHeading}`
      : match.pageTitle;

    const freshness = match.lastModified
      ? ` (updated ${match.lastModified.slice(0, 7)})`
      : "";

    const excerpt = truncateAtWordBoundary(
      match.rawText.replace(/\n/g, " ").trim(),
      MAX_WIKI_EXCERPT_CHARS,
    );

    bullets.push(
      `- **[Wiki] ${label}** ([source](${match.pageUrl}))${freshness}:\n  "${excerpt}"`,
    );
  }

  return [
    "## Wiki Knowledge",
    "",
    "The following are relevant kodi.wiki articles. Reference them when the current change",
    "relates to documented Kodi architecture, APIs, or features. Cite with:",
    '`Per the wiki: "quote" ([source](url))`',
    "",
    "Only cite when directly relevant. Do not force citations.",
    "",
    "---",
    ...bullets,
    "---",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Unified cross-corpus context formatting (KI-17)
// ---------------------------------------------------------------------------

import type { UnifiedRetrievalChunk } from "../knowledge/cross-corpus-rrf.ts";

const MAX_UNIFIED_CITATIONS = 8;

/**
 * Format unified cross-corpus retrieval results as a prompt section.
 * Produces inline source labels with clickable links and alternate source annotations.
 *
 * Returns empty string when no results exist.
 */
export function formatUnifiedContext(params: {
  unifiedResults: UnifiedRetrievalChunk[];
  contextWindow?: string;
  maxCitations?: number;
}): string {
  const { unifiedResults, contextWindow, maxCitations = MAX_UNIFIED_CITATIONS } = params;

  if (unifiedResults.length === 0) return "";

  // If contextWindow is pre-assembled, use it as a base
  if (contextWindow) {
    const bullets: string[] = [];
    const capped = unifiedResults.slice(0, maxCitations);

    for (const chunk of capped) {
      const label = chunk.sourceUrl
        ? `${chunk.sourceLabel}(${chunk.sourceUrl})`
        : chunk.sourceLabel;

      const excerpt = truncateAtWordBoundary(
        chunk.text.replace(/\n/g, " ").trim(),
        300,
      );

      let entry = `- ${label}: "${excerpt}"`;

      // Alternate source annotations
      if (chunk.alternateSources && chunk.alternateSources.length > 0) {
        entry += ` (also found in ${chunk.alternateSources.join(", ")})`;
      }

      bullets.push(entry);
    }

    return [
      "## Knowledge Context",
      "",
      "Relevant context from code reviews, human review comments, and wiki documentation.",
      "Cite sources naturally using their labels. Only cite when directly relevant.",
      "",
      "---",
      ...bullets,
      "---",
    ].join("\n");
  }

  return "";
}

// ---------------------------------------------------------------------------
// Helper: Language-specific guidance section (CTX-06)
// ---------------------------------------------------------------------------
export function buildLanguageGuidanceSection(
  filesByLanguage: Record<string, string[]>,
): string {
  const entries = Object.entries(filesByLanguage)
    .filter(([lang]) => lang in LANGUAGE_GUIDANCE)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_LANGUAGE_GUIDANCE_ENTRIES);

  if (entries.length === 0) return "";

  const lines: string[] = ["## Language-Specific Guidance", ""];

  for (const [lang, files] of entries) {
    lines.push(`### ${lang} (${files.length} file(s))`, "");
    for (const rule of LANGUAGE_GUIDANCE[lang]!) {
      lines.push(`- ${rule}`);
    }
    lines.push("");
  }

  lines.push(
    "These language-specific rules supplement the severity classification. " +
      "Use the same CRITICAL/MAJOR/MEDIUM/MINOR severity scale and the same category taxonomy " +
      "(security, correctness, performance, error-handling, resource-management, concurrency) " +
      "for all findings regardless of language.",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Output language localization section (LANG-01)
// ---------------------------------------------------------------------------
export function buildOutputLanguageSection(outputLanguage: string): string {
  if (!outputLanguage || outputLanguage.toLowerCase() === "en") return "";

  return [
    "## Output Language",
    "",
    `Write all explanatory prose, finding descriptions, and summary text in ${outputLanguage}.`,
    "",
    "The following MUST remain in English:",
    "- Severity labels (CRITICAL, MAJOR, MEDIUM, MINOR)",
    "- Category labels (security, correctness, performance, error-handling, resource-management, concurrency)",
    "- Code identifiers, variable names, function names, and type names",
    "- Code snippets inside suggestion blocks",
    "- File paths",
    "- YAML metadata blocks (in enhanced mode)",
    "",
    "Only the human-readable explanation text should be localized.",
  ].join("\n");
}

function buildSearchRateLimitDegradationSection(params: {
  retryAttempts: number;
  skippedQueries: number;
  degradationPath: string;
}): string {
  return [
    "## Search API Degradation Context",
    "",
    "Search enrichment was rate-limited while collecting author-tier context.",
    SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE,
    `Retry attempts used: ${params.retryAttempts}.`,
    `Skipped queries: ${params.skippedQueries}.`,
    `Degradation path: ${params.degradationPath}.`,
    "",
    "In the summary comment, include one short note in ## What Changed using this exact sentence:",
    `"${SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE}"`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Character budget utilities for enrichment sections
// ---------------------------------------------------------------------------
const MAX_ADVISORY_SECTION_CHARS = 500;
const MAX_CHANGELOG_SECTION_CHARS = 1500;

function truncateToCharBudget(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf("\n");
  if (lastNewline > 0) {
    return truncated.slice(0, lastNewline) + "\n...(truncated)";
  }
  return truncated + "\n...(truncated)";
}

// ---------------------------------------------------------------------------
// Helper: Security advisory section (SEC-01/02/03)
// ---------------------------------------------------------------------------
function buildSecuritySection(security: SecurityContext): string {
  if (security.advisories.length === 0) return "";

  const lines: string[] = [];

  if (security.isSecurityBump) {
    lines.push(
      "### Security-Motivated Bump",
      "",
      "The old version has known advisories that the new version patches. This bump addresses security concerns.",
      "",
    );
  } else {
    lines.push(
      "### Security Advisories (informational)",
      "",
      "The following advisories exist for this package. They may or may not affect your specific usage.",
      "",
    );
  }

  const advisoriesToShow = security.advisories.slice(0, 3);
  for (const adv of advisoriesToShow) {
    lines.push(`- **${adv.ghsaId}** (${adv.severity}): ${adv.summary}`);
    if (adv.cveId) {
      lines.push(`  CVE: ${adv.cveId}`);
    }
    if (adv.firstPatchedVersion) {
      lines.push(`  Patched in: ${adv.firstPatchedVersion}`);
    }
    lines.push(`  Details: ${adv.url}`);
  }

  return truncateToCharBudget(lines.join("\n"), MAX_ADVISORY_SECTION_CHARS);
}

// ---------------------------------------------------------------------------
// Helper: Changelog section (CLOG-01/02/03)
// ---------------------------------------------------------------------------
function buildChangelogSection(changelog: ChangelogContext): string {
  const lines: string[] = [];

  if (changelog.source === "releases" && changelog.releaseNotes.length > 0) {
    lines.push("### Release Notes", "");
    for (const note of changelog.releaseNotes) {
      const body = note.body.length > 500 ? note.body.slice(0, 500) + "..." : note.body;
      lines.push(`**${note.tag}:**`, body, "");
    }
  } else if (changelog.source === "changelog-file" && changelog.releaseNotes.length > 0) {
    lines.push("### Changelog Excerpt", "");
    for (const note of changelog.releaseNotes) {
      const body = note.body.length > 500 ? note.body.slice(0, 500) + "..." : note.body;
      lines.push(body, "");
    }
  }

  if (changelog.breakingChanges.length > 0) {
    lines.push("**Breaking Changes Detected:**", "");
    for (const bc of changelog.breakingChanges) {
      lines.push(`- ${bc}`);
    }
    lines.push("");
  }

  if (changelog.compareUrl) {
    if (changelog.source === "compare-url-only") {
      lines.push(`No release notes or changelog found. [View full diff](${changelog.compareUrl})`);
    } else {
      lines.push(`[View full diff](${changelog.compareUrl})`);
    }
  }

  if (lines.length === 0) return "";

  return truncateToCharBudget(lines.join("\n"), MAX_CHANGELOG_SECTION_CHARS);
}

// ---------------------------------------------------------------------------
// Helper: Dependency bump context section (DEP-01/02/03)
// ---------------------------------------------------------------------------
function buildDepBumpSection(ctx: DepBumpContext): string {
  const lines = [
    "## Dependency Bump Context",
    "",
    `This PR is an automated dependency update (detected via: ${ctx.detection.signals.join(", ")}).`,
    "",
  ];

  // ── Merge confidence badge (CONF-01/02) ──
  if (ctx.mergeConfidence) {
    const emojiMap: Record<MergeConfidenceLevel, string> = {
      high: ":green_circle:",
      medium: ":yellow_circle:",
      low: ":red_circle:",
    };
    const labelMap: Record<MergeConfidenceLevel, string> = {
      high: "High Confidence",
      medium: "Review Recommended",
      low: "Careful Review Required",
    };
    lines.push(
      `**Merge Confidence: ${emojiMap[ctx.mergeConfidence.level]} ${labelMap[ctx.mergeConfidence.level]}**`,
    );
    for (const r of ctx.mergeConfidence.rationale) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }

  if (ctx.details.isGroup) {
    lines.push("This is a **group dependency update** affecting multiple packages.");
  }
  if (ctx.details.packageName) {
    lines.push(`- **Package:** ${ctx.details.packageName}`);
  }
  if (ctx.details.oldVersion && ctx.details.newVersion) {
    lines.push(`- **Version:** ${ctx.details.oldVersion} → ${ctx.details.newVersion}`);
  } else if (ctx.details.newVersion) {
    lines.push(`- **Version:** → ${ctx.details.newVersion}`);
  }
  if (ctx.details.ecosystem) {
    lines.push(`- **Ecosystem:** ${ctx.details.ecosystem}`);
  }
  if (ctx.classification.bumpType !== "unknown") {
    lines.push(`- **Bump type:** ${ctx.classification.bumpType}`);
  }

  lines.push("");

  if (ctx.classification.isBreaking) {
    lines.push(
      "**⚠ MAJOR version bump — potential breaking changes.**",
      "Focus your review on:",
      "- Breaking API changes in the updated dependency",
      "- Deprecated features that may have been removed",
      "- Migration requirements or compatibility issues",
      "- Whether test coverage exercises the dependency's changed API surface",
    );
  } else {
    lines.push(
      "This is a minor/patch dependency update (low risk).",
      "Focus your review on:",
      "- Verify lockfile changes are consistent with the manifest change",
      "- Check for unexpected additions to the dependency tree",
      "- Keep review concise — minor/patch bumps are routine maintenance",
    );
  }

  // Append enrichment sections if available
  if (ctx.security) {
    const secSection = buildSecuritySection(ctx.security);
    if (secSection) {
      lines.push("", secSection);
    }
  }
  if (ctx.changelog) {
    const clogSection = buildChangelogSection(ctx.changelog);
    if (clogSection) {
      lines.push("", clogSection);
    }
  }

  // ── Workspace usage evidence (DEP-04) ──
  if (ctx.usageEvidence?.evidence?.length && ctx.usageEvidence.evidence.length > 0) {
    lines.push(
      "",
      "### Workspace Usage Evidence",
      "",
      "The following files in this repo import or use APIs affected by this bump:",
    );

    const capped = ctx.usageEvidence.evidence.slice(0, 10);
    for (const ev of capped) {
      const snippet = (ev.snippet ?? "").replace(/`/g, "'").slice(0, 200);
      lines.push(`- \`${ev.filePath}:${ev.line}\` -- \`${snippet}\``);
    }

    const remaining = ctx.usageEvidence.evidence.length - capped.length;
    if (remaining > 0) {
      lines.push(`- ... and ${remaining} more locations`);
    }

    if (ctx.usageEvidence.timedOut) {
      lines.push("", "(usage analysis timed out -- evidence may be incomplete)");
    }
  } else if (ctx.usageEvidence?.timedOut) {
    lines.push("", "(usage analysis timed out -- evidence may be incomplete)");
  }

  // ── Multi-package scope coordination (DEP-06) ──
  if (ctx.scopeGroups?.length && ctx.scopeGroups.length > 0) {
    lines.push("", "### Multi-Package Coordination", "");
    for (const group of ctx.scopeGroups) {
      lines.push(
        `- Packages from \`${group.scope}\` scope updated together: ${group.packages.join(", ")}. Review for cross-package compatibility.`,
      );
    }
  }

  // ── Verdict integration instructions (CONF-02) ──
  if (ctx.mergeConfidence) {
    lines.push(
      "",
      "When writing your ## Verdict, include the merge confidence assessment.",
      "Merge confidence reflects dependency version change risk (semver, advisories, breaking changes).",
      "Your Verdict reflects code review findings. Both assessments are independent.",
      "If they conflict, explain why (e.g., 'dependency change is low-risk but code issues exist').",
    );
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
  checkpointEnabled?: boolean;
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
  incrementalContext?: {
    lastReviewedHeadSha: string;
    changedFilesSinceLastReview: string[];
    unresolvedPriorFindings: PriorFinding[];
  } | null;
  retrievalContext?: {
    findings: Array<{
      findingText: string;
      severity: string;
      category: string;
      path: string;
      line?: number;
      snippet?: string;
      outcome: string;
      distance: number;
      sourceRepo: string;
    }>;
    maxChars?: number;
  } | null;
  reviewPrecedents?: ReviewCommentMatch[];
  wikiKnowledge?: WikiKnowledgeMatch[];
  filesByLanguage?: Record<string, string[]>;
  outputLanguage?: string;
  prLabels?: string[];
  focusHints?: string[];
  conventionalType?: ConventionalCommitType | null;
  deltaContext?: DeltaReviewContext | null;
  largePRContext?: {
    fullReviewFiles: string[];
    abbreviatedFiles: string[];
    mentionOnlyCount: number;
    totalFiles: number;
  } | null;
  authorTier?: AuthorTier;
  authorExpertise?: { dimension: string; topic: string; score: number }[];
  depBumpContext?: DepBumpContext | null;
  searchRateLimitDegradation?: {
    degraded: boolean;
    retryAttempts: number;
    skippedQueries: number;
    degradationPath: string;
  } | null;
  isDraft?: boolean;
  // Unified cross-corpus retrieval (KI-13/KI-17)
  unifiedResults?: UnifiedRetrievalChunk[];
  contextWindow?: string;
  // Review pattern clustering (CLST-03)
  clusterPatterns?: ClusterPatternMatch[];
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

  if (context.prLabels && context.prLabels.length > 0) {
    lines.push(`Labels: ${context.prLabels.join(", ")}`);
  }

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
    ? buildDiffAnalysisSection(context.diffAnalysis, {
        suppressLargePRMessage: Boolean(context.largePRContext),
      })
    : "";
  if (diffAnalysisSection) {
    lines.push("", diffAnalysisSection);
  }

  // --- Large PR triage section ---
  if (context.largePRContext) {
    lines.push("", buildLargePRTriageSection(context.largePRContext));
  }

  // --- Incremental review context ---
  if (context.incrementalContext) {
    lines.push("", buildIncrementalReviewSection(context.incrementalContext));
  }

  // --- Knowledge context (unified cross-corpus or legacy) ---
  if (context.unifiedResults && context.unifiedResults.length > 0) {
    // Unified cross-corpus retrieval (KI-13/KI-17): single section replaces
    // separate retrieval, precedent, and wiki sections
    const unifiedSection = formatUnifiedContext({
      unifiedResults: context.unifiedResults,
      contextWindow: context.contextWindow,
    });
    if (unifiedSection) {
      lines.push("", unifiedSection);
    }
  } else {
    // Legacy path: separate sections for backward compatibility
    if (context.retrievalContext && context.retrievalContext.findings.length > 0) {
      const retrievalSection = buildRetrievalContextSection({
        findings: context.retrievalContext.findings,
        maxChars: context.retrievalContext.maxChars,
      });
      if (retrievalSection) {
        lines.push("", retrievalSection);
      }
    }

    if (context.reviewPrecedents && context.reviewPrecedents.length > 0) {
      const precedentsSection = formatReviewPrecedents(context.reviewPrecedents);
      if (precedentsSection) {
        lines.push("", precedentsSection);
      }
    }

    if (context.wikiKnowledge && context.wikiKnowledge.length > 0) {
      const wikiSection = formatWikiKnowledge(context.wikiKnowledge);
      if (wikiSection) {
        lines.push("", wikiSection);
      }
    }

    // Review pattern clustering (CLST-03)
    if (context.clusterPatterns && context.clusterPatterns.length > 0) {
      const clusterPatternsSection = formatClusterPatterns(context.clusterPatterns);
      if (clusterPatternsSection) {
        lines.push("", clusterPatternsSection);
      }
    }
  }

  // --- Language-specific guidance ---
  if (context.filesByLanguage) {
    const langSection = buildLanguageGuidanceSection(context.filesByLanguage);
    if (langSection) lines.push("", langSection);
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

  if (context.checkpointEnabled === true) {
    lines.push(
      "",
      "IMPORTANT: This review may time out. Call the save_review_checkpoint tool after reviewing every 3-5 files. Include:",
      "- filesReviewed: list of file paths you have fully analyzed",
      "- findingCount: total findings generated so far",
      "- summaryDraft: a brief summary of findings so far",
      "",
      "This ensures your work is preserved if the session times out.",
    );
  }

  // --- Rules ---
  lines.push(
    "",
    "## Rules",
    "",
    "- ONLY report actionable issues that need to be fixed",
    '- NO positive feedback, NO "looks good"',
    "- In standard mode, use the five-section template (What Changed, Strengths, Observations, Suggestions, Verdict) for the summary comment",
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

  // --- PR intent scoping ---
  lines.push(
    "",
    buildPrIntentScopingSection(
      titleTruncated.text,
      context.prLabels ?? [],
      context.headBranch,
    ),
  );

  // --- Focus hints (INTENT-01) ---
  if (context.focusHints && context.focusHints.length > 0) {
    const rendered: string[] = [];
    const seen = new Set<string>();
    for (const raw of context.focusHints) {
      const normalized = raw.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      rendered.push(`- [${normalized.toUpperCase()}]`);
    }

    if (rendered.length > 0) {
      lines.push(
        "",
        "## Focus Hints",
        "",
        "These tags came from the PR title/commits; treat them as components/platforms to pay extra attention to when reviewing.",
        "Do not invent context if the diff does not touch the hinted areas.",
        "",
        ...rendered,
      );
    }
  }

  if (context.conventionalType) {
    const typeGuidance: Record<string, string> = {
      feat: "This is a feature PR. Pay extra attention to: breaking changes in public APIs, missing test coverage for new behavior, documentation for new functionality.",
      fix: "This is a bug fix PR. Pay extra attention to: whether the fix addresses the root cause, test coverage for the fixed scenario, potential regression in related code paths.",
      docs: "This is a documentation PR. Apply lighter review: focus on accuracy of technical content, broken links, and code example correctness. Minimize style findings.",
      refactor: "This is a refactoring PR. Pay extra attention to: behavior preservation (no functional changes), test coverage continuity, and import/export consistency.",
      perf: "This is a performance PR. Pay extra attention to: benchmark methodology, potential correctness trade-offs, and algorithmic complexity changes.",
      test: "This is a test PR. Focus on: test reliability, assertion specificity, edge case coverage. Minimize style findings on production code.",
      ci: "This is a CI/build PR. Focus on: pipeline correctness, security of new dependencies or scripts, and configuration accuracy. Minimize code style findings.",
      chore: "This is a maintenance PR. Apply lighter review: focus on correctness and potential breakage. Minimize style findings.",
    };
    const guidance = typeGuidance[context.conventionalType.type];
    if (guidance) {
      lines.push("", "## Conventional Commit Context", "", guidance);
    }
    if (context.conventionalType.isBreaking) {
      lines.push(
        "",
        "**BREAKING CHANGE indicated.** Verify: backward compatibility impact is documented, migration path exists if applicable, and all affected consumers are addressed.",
      );
    }
  }

  // --- Tone and language guidelines ---
  lines.push("", buildToneGuidelinesSection());

  if (context.authorTier) {
    const authorExpSection = buildAuthorExperienceSection({
      tier: context.authorTier,
      authorLogin: context.prAuthor,
      areaExpertise: context.authorExpertise,
    });
    if (authorExpSection) lines.push("", authorExpSection);
  }

  // --- Dependency bump context (DEP-01/02/03) ---
  if (context.depBumpContext) {
    lines.push("", buildDepBumpSection(context.depBumpContext));
  }

  if (context.searchRateLimitDegradation?.degraded) {
    lines.push(
      "",
      buildSearchRateLimitDegradationSection({
        retryAttempts: context.searchRateLimitDegradation.retryAttempts,
        skippedQueries: context.searchRateLimitDegradation.skippedQueries,
        degradationPath: context.searchRateLimitDegradation.degradationPath,
      }),
    );
  }

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

  // --- Summary comment ---
  if (mode === "enhanced") {
    lines.push(
      "",
      "## Summary comment",
      "",
      "Do NOT post a top-level summary comment. Each inline comment stands alone with its own severity and category metadata.",
      "If NO issues found: do nothing.",
    );
  } else if (context.deltaContext) {
    // --- Delta re-review template (FORMAT-14/15/16) ---
    const deltaSha7 = context.deltaContext.lastReviewedHeadSha.slice(0, 7);

    // Push delta review context section BEFORE the summary comment template
    lines.push("", buildDeltaReviewContext(context.deltaContext));

    lines.push(
      "",
      "## Summary comment",
      "",
      "This is a re-review. Use the DELTA template below instead of the standard five-section template.",
      "",
      "ONLY post a summary comment if you found changes to report (new, resolved, or still-open findings).",
      "",
      `If you found changes to report, FIRST post ONE summary comment using the \`mcp__github_comment__create_comment\` tool with issue number ${context.prNumber}. ALWAYS wrap the summary in \`<details>\` tags:`,
      "",
      "<details>",
      "<summary>Kodiai Re-Review Summary</summary>",
      "",
      `## Re-review -- Changes since ${deltaSha7}`,
      "",
      "## What Changed",
      "<1-2 sentence summary of what changed since the last review>",
      "",
      "## New Findings",
      ":new: [CRITICAL] path/to/file.ts (123): <issue title>",
      "<explanation of the new issue>",
      "",
      ":new: [MAJOR] path/to/file.ts (45): <issue title>",
      "<explanation of the new issue>",
      "",
      "## Resolved Findings",
      ":white_check_mark: [CRITICAL] path/to/file.ts: <issue title> -- resolved",
      ":white_check_mark: [MAJOR] path/to/file.ts: <issue title> -- resolved",
      "",
      "## Still Open",
      "<count> finding(s) from the previous review remain open.",
      "",
      "<details>",
      "<summary>View still-open findings</summary>",
      "",
      "- [MEDIUM] path/to/file.ts: <issue title>",
      "- [MINOR] path/to/file.ts: <issue title>",
      "",
      "</details>",
      "",
      "## Verdict Update",
      ":green_circle: **Blockers resolved** -- Ready to merge",
      ":yellow_circle: **New blockers found** -- Address [N] new issue(s)",
      ":large_blue_circle: **Still ready** -- No new issues",
      "",
      "</details>",
      "",
      buildDeltaVerdictLogicSection(),
      "",
      "Hard requirements for the re-review summary:",
      "- Use <summary>Kodiai Re-Review Summary</summary> (NOT 'Kodiai Review Summary')",
      "- ## Re-review header REQUIRED with prior SHA reference",
      "- ## What Changed REQUIRED",
      "- ## Verdict Update REQUIRED",
      "- ## New Findings, ## Resolved Findings, ## Still Open each OPTIONAL but at least one must be present",
      "- Omit empty sections entirely (do NOT write empty section placeholders)",
      "- Do NOT repeat still-open findings in ## New Findings",
      "- Still-open findings appear ONLY in ## Still Open as count + expandable <details> list",
      "- New findings use :new: badge before severity tag",
      "- Resolved findings use :white_check_mark: badge and append ' -- resolved'",
      "- Still-open findings show severity and file path but NOT line numbers (stale)",
      "",
      "If you found changes to report (new, resolved, or still-open findings): post the delta summary (wrapped in `<details>`) first, then post inline comments ONLY for new findings.",
      "If the delta produces nothing to report: do nothing.",
    );
  } else {
    const reviewedLine = buildReviewedCategoriesLine(
      context.diffAnalysis?.filesByCategory ?? {},
    );
    const reviewedLineInstruction = reviewedLine
      ? `\nInclude this line after the summary: "${reviewedLine}"\n`
      : "";

    lines.push(
      "",
      "## Summary comment",
      "",
      "ONLY post a summary comment if you found actionable issues to report as inline comments.",
      "",
      `If you found issues, FIRST post ONE summary comment using the \`mcp__github_comment__create_comment\` tool with issue number ${context.prNumber}. ALWAYS wrap the summary in \`<details>\` tags:`,
      "",
      "<details>",
      context.isDraft
        ? "<summary>\ud83d\udcdd Kodiai Draft Review Summary</summary>"
        : "<summary>Kodiai Review Summary</summary>",
      "",
      ...(context.isDraft
        ? ["> **Draft** \u2014 This PR is still in draft. Feedback is exploratory; findings use softer language.", ""]
        : []),
      "## What Changed",
      "<1-2 sentence summary of PR intent from title and description>",
      reviewedLineInstruction,
      "## Strengths",
      "- :white_check_mark: <specific verified positive about the code changes>",
      "- :white_check_mark: <specific verified positive about the code changes>",
      "",
      "## Observations",
      "",
      "### Impact",
      "<findings about correctness, security, performance, error handling, resource management, concurrency>",
      "",
      "[CRITICAL] path/to/file.ts (123, 456): <issue title>",
      "<concrete condition and consequence: 'causes X when Y'>",
      "",
      "[MAJOR] path/to/file.ts (789): <issue title>",
      "<concrete condition and consequence>",
      "",
      "### Preference",
      "<optional findings about style, naming, code organization>",
      "",
      "[MINOR] path/to/file.ts (101): <issue title>",
      "Optional: <specific suggestion with actionable language>",
      "",
      "## Suggestions",
      "- Optional: <low-friction cleanup or improvement>",
      "- Future consideration: <larger improvement for a follow-up PR>",
      "",
      "## Verdict",
      ":green_circle: **Ready to merge** -- No blocking issues found",
      ":yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below (no blockers)",
      ":red_circle: **Address before merging** -- [N] blocking issue(s) found (CRITICAL/MAJOR)",
      "",
      "</details>",
      "",
      buildVerdictLogicSection(),
      "",
      "Hard requirements for the summary comment:",
      "- ## What Changed and ## Observations and ## Verdict are REQUIRED sections",
      "- ## Strengths and ## Suggestions are OPTIONAL -- omit if nothing meaningful to say",
      "- Section order MUST be: What Changed, Strengths, Observations, Suggestions, Verdict",
      "- Do NOT add any other ## headings",
      "- Under ## Observations, use ### Impact and ### Preference subsections. ### Impact is REQUIRED; ### Preference is optional (omit if no preference findings). Each finding line starts with a severity tag: [CRITICAL], [MAJOR], [MEDIUM], or [MINOR]",
      "- CRITICAL and MAJOR findings MUST go under ### Impact. Preference findings are capped at MEDIUM severity",
      "- Prefix Preference findings with 'Optional:' to signal they are non-blocking",
      "- Under ## Strengths, prefix each item with :white_check_mark: -- list 1-3 specific verified positives about the code changes, each must cite a concrete observation",
      "- Under ## Suggestions, every item MUST start with 'Optional:' or 'Future consideration:' -- suggestions are NEVER counted against merge readiness -- omit this section if you have no suggestions",
      "- Under ## Verdict, use exactly one verdict line with emoji -- determine which one using the Verdict Logic rules above",
      "- A blocker is any [CRITICAL] or [MAJOR] finding under ### Impact. Zero blockers = :green_circle: or :yellow_circle: verdict. Never :red_circle: without blockers",
      "- Since this summary is only posted when issues exist, the verdict will typically be :yellow_circle: or :red_circle:. Use :green_circle: only when all findings are in ### Preference with no Impact findings",
      ...(context.isDraft
        ? [
            "- This is a DRAFT review: use suggestive framing for all findings. Say 'Consider...' or 'You might want to...' instead of 'Should...' or 'Fix this' or 'Must...'",
            "- Prefix inline comment bodies with 'Consider: ' or 'You might want to: ' instead of imperative directives",
          ]
        : []),
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
  } else if (!context.deltaContext) {
    // Standard mode after-review (delta mode includes its own after-review instructions above)
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

  // --- Output language localization (placed last for recency bias compliance) ---
  const outputLangSection = buildOutputLanguageSection(context.outputLanguage ?? "en");
  if (outputLangSection) lines.push("", outputLangSection);

  return lines.join("\n");
}
