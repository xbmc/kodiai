/**
 * prompt-context.ts
 *
 * Converts a `ReviewGraphBlastRadiusResult` into a bounded, rank-ordered prompt
 * section for the review prompt. The goal is to surface high-signal graph
 * evidence (impacted files, likely tests, probable dependents) without ever
 * dumping the full blast radius into the prompt.
 *
 * Design invariants:
 * - Each sub-list is capped both by item count (max ranks) and by total char
 *   budget so the section size is deterministically bounded.
 * - Items within each sub-list are rank-ordered by score DESC so the highest-
 *   signal entries survive when the cap is hit.
 * - The section is self-describing: counts, a truncation note, and per-entry
 *   confidence labels let the reviewer understand what was omitted.
 */

import type { ReviewGraphBlastRadiusResult, ReviewGraphRankedFile, ReviewGraphDependent } from "./query.ts";

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export type GraphContextOptions = {
  /**
   * Maximum impacted-file rows to include in the prompt.
   * Default: 10. Capped hard at 20.
   */
  maxImpactedFiles?: number;
  /**
   * Maximum likely-test rows to include in the prompt.
   * Default: 5. Capped hard at 10.
   */
  maxLikelyTests?: number;
  /**
   * Maximum probable-dependent rows to include in the prompt.
   * Default: 5. Capped hard at 10.
   */
  maxDependents?: number;
  /**
   * Hard character-budget for the entire section (including header).
   * When the built section exceeds this value it is truncated and a note
   * is appended. Default: 2500.
   */
  maxChars?: number;
};

export type GraphContextSection = {
  /** The rendered Markdown section, ready for prompt injection. */
  text: string;
  /** True when any sub-list was truncated due to the char budget. */
  truncated: boolean;
  /** Counts from the assembled section for observability. */
  stats: {
    impactedFilesIncluded: number;
    likelyTestsIncluded: number;
    dependentsIncluded: number;
    charCount: number;
  };
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const HARD_CAP_IMPACTED = 20;
const HARD_CAP_TESTS = 10;
const HARD_CAP_DEPENDENTS = 10;

const DEFAULT_MAX_IMPACTED = 10;
const DEFAULT_MAX_TESTS = 5;
const DEFAULT_MAX_DEPENDENTS = 5;
const DEFAULT_MAX_CHARS = 2500;

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

function renderImpactedFile(file: ReviewGraphRankedFile): string {
  const conf = confidenceLabel(file.confidence);
  const reason = file.reasons[0] ?? "graph edge";
  return `- \`${file.path}\` (score: ${file.score.toFixed(3)}, confidence: ${conf}) — ${reason}`;
}

function renderDependent(dep: ReviewGraphDependent): string {
  const conf = confidenceLabel(dep.confidence);
  const sym = dep.qualifiedName ?? dep.symbolName ?? dep.stableKey;
  const reason = dep.reasons[0] ?? "calls changed symbol";
  return `- \`${sym}\` in \`${dep.filePath}\` (score: ${dep.score.toFixed(3)}, confidence: ${conf}) — ${reason}`;
}

function renderLikelyTest(file: ReviewGraphRankedFile): string {
  const conf = confidenceLabel(file.confidence);
  const reason = file.reasons[0] ?? "test heuristic";
  return `- \`${file.path}\` (score: ${file.score.toFixed(3)}, confidence: ${conf}) — ${reason}`;
}

/**
 * Pack items into a sub-section, respecting a remaining char budget.
 * Returns { lines, included, exhaustedBudget }.
 */
function packSubSection<T>(
  items: T[],
  maxItems: number,
  render: (item: T) => string,
  charBudget: number,
): { lines: string[]; included: number; exhaustedBudget: boolean } {
  const capped = items.slice(0, maxItems);
  const lines: string[] = [];
  let remaining = charBudget;

  for (const item of capped) {
    const line = render(item);
    const cost = line.length + 1; // +1 for newline
    if (remaining - cost < 0) {
      return { lines, included: lines.length, exhaustedBudget: true };
    }
    lines.push(line);
    remaining -= cost;
  }

  return { lines, included: lines.length, exhaustedBudget: false };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a bounded graph-context section from a blast-radius result.
 *
 * Returns an empty section when:
 * - `blastRadius` is null or undefined
 * - All three sub-lists are empty
 * - `maxChars` is 0
 */
export function buildGraphContextSection(
  blastRadius: ReviewGraphBlastRadiusResult | null | undefined,
  options: GraphContextOptions = {},
): GraphContextSection {
  const empty: GraphContextSection = {
    text: "",
    truncated: false,
    stats: { impactedFilesIncluded: 0, likelyTestsIncluded: 0, dependentsIncluded: 0, charCount: 0 },
  };

  if (!blastRadius) return empty;

  const maxImpacted = Math.min(
    options.maxImpactedFiles ?? DEFAULT_MAX_IMPACTED,
    HARD_CAP_IMPACTED,
  );
  const maxTests = Math.min(
    options.maxLikelyTests ?? DEFAULT_MAX_TESTS,
    HARD_CAP_TESTS,
  );
  const maxDeps = Math.min(
    options.maxDependents ?? DEFAULT_MAX_DEPENDENTS,
    HARD_CAP_DEPENDENTS,
  );
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  if (maxChars <= 0) return empty;

  const hasImpacted = blastRadius.impactedFiles.length > 0;
  const hasTests = blastRadius.likelyTests.length > 0;
  const hasDeps = blastRadius.probableDependents.length > 0;

  if (!hasImpacted && !hasTests && !hasDeps) return empty;

  const TRUNCATION_NOTE = "_Note: Graph context truncated — additional entries omitted due to prompt size budget._";
  const reservedForNote = TRUNCATION_NOTE.length + 2;
  const effectiveBudget = Math.max(0, maxChars - reservedForNote);

  const headerLines: string[] = [
    "## Graph-Derived Review Context",
    "",
    "The following files and symbols are impacted by this change according to the repository's structural graph.",
    "Review these areas for call-chain correctness, test coverage, and side-effects.",
    "",
    `_Graph stats: ${blastRadius.graphStats.files} files, ${blastRadius.graphStats.nodes} nodes, ${blastRadius.graphStats.edges} edges; ${blastRadius.graphStats.changedFilesFound}/${blastRadius.changedFiles.length} changed files resolved in graph._`,
  ];

  const parts: string[] = [...headerLines];
  let budgetUsed = headerLines.join("\n").length + 1;

  let impactedIncluded = 0;
  let testsIncluded = 0;
  let depsIncluded = 0;
  let truncated = false;

  // --- Impacted files ---
  if (hasImpacted) {
    const subHeader = [`### Impacted Files (${blastRadius.impactedFiles.length} found, showing top ${Math.min(maxImpacted, blastRadius.impactedFiles.length)})`, ""];
    const subHeaderLen = subHeader.join("\n").length + 1;

    const { lines, included, exhaustedBudget } = packSubSection(
      blastRadius.impactedFiles,
      maxImpacted,
      renderImpactedFile,
      effectiveBudget - budgetUsed - subHeaderLen,
    );

    parts.push("", ...subHeader);
    budgetUsed += subHeaderLen + 1;

    if (lines.length > 0) {
      parts.push(...lines);
      budgetUsed += lines.join("\n").length + 1;
    }

    impactedIncluded = included;

    if (exhaustedBudget || included < blastRadius.impactedFiles.length) {
      if (exhaustedBudget) {
        truncated = true;
      }
    }
  }

  // --- Likely tests ---
  if (hasTests && !truncated) {
    const subHeader = [`### Likely Affected Tests (${blastRadius.likelyTests.length} found, showing top ${Math.min(maxTests, blastRadius.likelyTests.length)})`, ""];
    const subHeaderLen = subHeader.join("\n").length + 1;

    const { lines, included, exhaustedBudget } = packSubSection(
      blastRadius.likelyTests,
      maxTests,
      renderLikelyTest,
      effectiveBudget - budgetUsed - subHeaderLen,
    );

    parts.push("", ...subHeader);
    budgetUsed += subHeaderLen + 1;

    if (lines.length > 0) {
      parts.push(...lines);
      budgetUsed += lines.join("\n").length + 1;
    }

    testsIncluded = included;

    if (exhaustedBudget) {
      truncated = true;
    }
  }

  // --- Probable dependents ---
  if (hasDeps && !truncated) {
    const subHeader = [`### Probable Dependents (${blastRadius.probableDependents.length} found, showing top ${Math.min(maxDeps, blastRadius.probableDependents.length)})`, ""];
    const subHeaderLen = subHeader.join("\n").length + 1;

    const { lines, included, exhaustedBudget } = packSubSection(
      blastRadius.probableDependents,
      maxDeps,
      renderDependent,
      effectiveBudget - budgetUsed - subHeaderLen,
    );

    parts.push("", ...subHeader);
    budgetUsed += subHeaderLen + 1;

    if (lines.length > 0) {
      parts.push(...lines);
      budgetUsed += lines.join("\n").length + 1;
    }

    depsIncluded = included;

    if (exhaustedBudget) {
      truncated = true;
    }
  }

  if (truncated) {
    parts.push("", TRUNCATION_NOTE);
  }

  const text = parts.join("\n").trimEnd();
  const charCount = text.length;

  return {
    text,
    truncated,
    stats: {
      impactedFilesIncluded: impactedIncluded,
      likelyTestsIncluded: testsIncluded,
      dependentsIncluded: depsIncluded,
      charCount,
    },
  };
}
