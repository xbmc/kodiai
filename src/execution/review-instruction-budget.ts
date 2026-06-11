import type { PromptBudgetOutcome } from "./prompt-budget.ts";
import { estimatePromptTokens } from "./prompt-section-metrics.ts";

export type ReviewInstructionSectionId = (typeof REVIEW_INSTRUCTION_SECTIONS)[number]["id"];
type ReviewInstructionRetention = (typeof REVIEW_INSTRUCTION_SECTIONS)[number]["retention"];

export type ReviewInstructionSection = {
  id: ReviewInstructionSectionId;
  lines: string[];
};

type NormalizedReviewInstructionSection = {
  id: ReviewInstructionSectionId;
  text: string;
  position: number;
};

const REVIEW_INSTRUCTION_SECTIONS = [
  { id: "active-rules", retention: "low" },
  { id: "custom-instructions", retention: "low" },
  { id: "output-language", retention: "low" },
  { id: "repo-doctrine", retention: "low" },
  { id: "reading-and-reporting", retention: "high" },
  { id: "tool-availability", retention: "high" },
  { id: "candidate-finding-capture", retention: "medium" },
  { id: "checkpointing", retention: "high" },
  { id: "core-rules", retention: "high" },
  { id: "focus-hints", retention: "low" },
  { id: "trust-boundaries", retention: "high" },
  { id: "conventional-commit-context", retention: "low" },
  { id: "conventional-breaking-change", retention: "low" },
  { id: "tone-guidelines", retention: "medium" },
  { id: "author-experience", retention: "low" },
  { id: "dependency-bump-context", retention: "low" },
  { id: "breaking-change-evidence", retention: "medium" },
  { id: "search-rate-limit-degradation", retention: "low" },
  { id: "path-instructions", retention: "low" },
  { id: "comment-cap", retention: "high" },
  { id: "severity-filter", retention: "high" },
  { id: "focus-area-instructions", retention: "low" },
  { id: "suppression-rules", retention: "low" },
  { id: "confidence-threshold", retention: "high" },
  { id: "summary-enhanced-mode", retention: "high" },
  { id: "summary-delta-mode", retention: "high" },
  { id: "summary-standard-mode", retention: "high" },
  { id: "after-review-enhanced", retention: "high" },
  { id: "after-review-standard", retention: "high" },
] as const;

const REVIEW_INSTRUCTION_SECTION_RETENTION = new Map<ReviewInstructionSectionId, ReviewInstructionRetention>(
  REVIEW_INSTRUCTION_SECTIONS.map(({ id, retention }) => [id, retention]),
);
const REVIEW_INSTRUCTION_SECTION_ORDER = new Map<ReviewInstructionSectionId, number>(
  REVIEW_INSTRUCTION_SECTIONS.map(({ id }, index) => [id, index]),
);

function reviewInstructionRetentionRank(section: NormalizedReviewInstructionSection): number {
  const retention = REVIEW_INSTRUCTION_SECTION_RETENTION.get(section.id);
  if (retention === "low") return 0;
  if (retention === "medium") return 1;
  return 2;
}

function sortReviewInstructionSections<T extends { id: ReviewInstructionSectionId }>(sections: T[]): T[] {
  return [...sections].sort((a, b) =>
    (REVIEW_INSTRUCTION_SECTION_ORDER.get(a.id) ?? Number.MAX_SAFE_INTEGER)
      - (REVIEW_INSTRUCTION_SECTION_ORDER.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

function normalizeReviewInstructionSections(sections: ReviewInstructionSection[]): NormalizedReviewInstructionSection[] {
  const normalized: NormalizedReviewInstructionSection[] = [];
  for (const [position, section] of sortReviewInstructionSections(sections).entries()) {
    const lines = section.lines.map((line) => line.trimEnd());
    while (lines[0] === "") lines.shift();
    while (lines.at(-1) === "") lines.pop();
    if (lines.length === 0) continue;
    normalized.push({ id: section.id, text: lines.join("\n"), position });
  }
  return normalized;
}

function renderNormalizedReviewInstructionSections(sections: NormalizedReviewInstructionSection[]): string {
  return sortReviewInstructionSections(sections)
    .map((section) => section.text)
    .join("\n\n");
}

export function renderReviewInstructionSections(
  sections: ReviewInstructionSection[],
  budgetChars?: number,
): { lines: string[]; budgetOutcome?: PromptBudgetOutcome } {
  const normalized = normalizeReviewInstructionSections(sections);
  const originalText = renderNormalizedReviewInstructionSections(normalized);
  if (budgetChars === undefined) {
    return { lines: originalText ? originalText.split("\n") : [] };
  }
  if (originalText.length <= budgetChars) {
    // Within budget: still emit an outcome so per-review instruction size is
    // always observable in prompt-section telemetry (lets us tune the budget
    // from real data rather than guessing).
    return {
      lines: originalText ? originalText.split("\n") : [],
      budgetOutcome: {
        sectionName: "review-instructions",
        sectionPosition: -1,
        budgetChars,
        budgetTokens: estimatePromptTokens(budgetChars),
        includedChars: originalText.length,
        includedTokens: estimatePromptTokens(originalText.length),
        trimmedChars: 0,
        trimmedTokens: 0,
        status: "included",
        reason: "within-budget",
      },
    };
  }

  const included = new Set(normalized);
  const dropOrder = [...normalized].sort((a, b) =>
    reviewInstructionRetentionRank(a) - reviewInstructionRetentionRank(b)
      || b.position - a.position
  );

  let currentText = originalText;
  for (const section of dropOrder) {
    if (currentText.length <= budgetChars) break;
    if (reviewInstructionRetentionRank(section) >= 2) continue;
    included.delete(section);
    currentText = renderNormalizedReviewInstructionSections([...included]);
  }

  if (currentText.length > budgetChars) {
    currentText = currentText.slice(0, budgetChars);
  }

  const trimmedChars = originalText.length - currentText.length;
  return {
    lines: currentText ? currentText.split("\n") : [],
    budgetOutcome: {
      sectionName: "review-instructions",
      sectionPosition: -1,
      budgetChars,
      budgetTokens: estimatePromptTokens(budgetChars),
      includedChars: currentText.length,
      includedTokens: estimatePromptTokens(currentText.length),
      trimmedChars,
      trimmedTokens: estimatePromptTokens(trimmedChars),
      status: trimmedChars > 0 ? "trimmed" : "included",
      reason: trimmedChars > 0 ? "section-over-budget" : "within-budget",
    },
  };
}
