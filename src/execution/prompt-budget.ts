import { estimatePromptTokens } from "./prompt-section-metrics.ts";

/**
 * Fit `text` into `budgetChars` by dropping whole trailing blocks instead of cutting
 * mid-content.
 *
 * A raw `slice(0, budgetChars)` truncates wherever the character count runs out, which
 * for prose sections means a heading can survive with its body amputated, or a sentence
 * can stop mid-clause. The model has no way to detect either: it reads the surviving
 * prefix as a complete instruction. That failure mode is what silently removed the
 * verdict logic and the severity template from published reviews.
 *
 * Blocks are blank-line separated. Under pressure the caller gets fewer complete
 * instructions rather than partial ones.
 *
 * Degenerate case: if the FIRST block alone exceeds the budget there is nothing to drop,
 * so it is char-sliced. Callers in that state have a sizing problem this cannot fix.
 *
 * Which sections use this is declared by PromptSectionBudgetPolicy.truncation.
 */
export function truncateToBudgetByBlocks(text: string, budgetChars: number): string {
  if (budgetChars <= 0) return "";
  if (text.length <= budgetChars) return text;

  const kept: string[] = [];
  let length = 0;
  for (const block of text.split("\n\n")) {
    const added = kept.length === 0 ? block.length : block.length + 2;
    if (length + added > budgetChars) break;
    kept.push(block);
    length += added;
  }

  if (kept.length === 0) return text.slice(0, budgetChars);
  return kept.join("\n\n");
}

export type PromptBudgetStatus = "included" | "trimmed" | "bypassed";

export type PromptBudgetReason =
  | "within-budget"
  | "section-over-budget"
  | "zero-budget";

export type PromptBudgetSection = {
  sectionName: string;
  text: string;
};

export type PromptSectionBudgetPolicy = {
  sectionName: string;
  /** Maximum characters from this section that may be included in the prompt. */
  budgetChars: number;
  /**
   * How this section degrades when it exceeds its budget.
   *
   * "chars" (default) cuts at the character limit. Correct for evidence sections
   * (diff, knowledge, graph): they are not authored as prose blocks, and a longer
   * truncated diff beats a shorter complete one.
   *
   * "blocks" drops whole trailing blank-line-separated blocks. Correct for sections
   * that carry contracts the model must follow, where a char cut can leave a heading
   * without its body and the model cannot tell the difference. That failure silently
   * removed the verdict logic and severity template from published reviews.
   */
  truncation?: "chars" | "blocks";
};

export type PromptBudgetOutcome = {
  sectionName: string;
  sectionPosition: number;
  budgetChars: number;
  budgetTokens: number;
  includedChars: number;
  includedTokens: number;
  trimmedChars: number;
  trimmedTokens: number;
  status: PromptBudgetStatus;
  reason: PromptBudgetReason;
};

export type EvaluatePromptBudgetOptions = {
  sections: PromptBudgetSection[];
  budgets: PromptSectionBudgetPolicy[];
  separator?: string;
};

export type PromptBudgetEvaluation = {
  text: string;
  outcomes: PromptBudgetOutcome[];
};

export function evaluatePromptBudget(options: EvaluatePromptBudgetOptions): PromptBudgetEvaluation {
  const separator = options.separator ?? "\n";
  const budgetBySection = buildBudgetIndex(options.budgets);
  const includedTexts: string[] = [];

  const outcomes = options.sections.map((section, sectionPosition) => {
    const budget = budgetBySection.get(section.sectionName);
    if (budget === undefined) {
      throw new Error(`Missing prompt budget for section '${section.sectionName}'`);
    }

    const includedText = budget.truncation === "blocks"
      ? truncateToBudgetByBlocks(section.text, budget.budgetChars)
      : section.text.slice(0, budget.budgetChars);
    const includedChars = includedText.length;
    const trimmedChars = section.text.length - includedChars;

    if (includedChars > 0) {
      includedTexts.push(includedText);
    }

    return buildOutcome({
      sectionName: section.sectionName,
      sectionPosition,
      budgetChars: budget.budgetChars,
      includedChars,
      trimmedChars,
    });
  });

  return {
    text: includedTexts.join(separator),
    outcomes,
  };
}

function buildBudgetIndex(budgets: PromptSectionBudgetPolicy[]): Map<string, PromptSectionBudgetPolicy> {
  const budgetBySection = new Map<string, PromptSectionBudgetPolicy>();

  for (const budget of budgets) {
    if (!Number.isFinite(budget.budgetChars) || !Number.isInteger(budget.budgetChars)) {
      throw new Error(`Prompt budget for section '${budget.sectionName}' must be an integer character count`);
    }
    if (budget.budgetChars < 0) {
      throw new Error(`Prompt budget for section '${budget.sectionName}' cannot be negative`);
    }
    if (budgetBySection.has(budget.sectionName)) {
      throw new Error(`Duplicate prompt budget for section '${budget.sectionName}'`);
    }
    budgetBySection.set(budget.sectionName, budget);
  }

  return budgetBySection;
}

function buildOutcome(params: {
  sectionName: string;
  sectionPosition: number;
  budgetChars: number;
  includedChars: number;
  trimmedChars: number;
}): PromptBudgetOutcome {
  const status = getStatus(params);
  return {
    sectionName: params.sectionName,
    sectionPosition: params.sectionPosition,
    budgetChars: params.budgetChars,
    budgetTokens: estimatePromptTokens(params.budgetChars),
    includedChars: params.includedChars,
    includedTokens: estimatePromptTokens(params.includedChars),
    trimmedChars: params.trimmedChars,
    trimmedTokens: estimatePromptTokens(params.trimmedChars),
    status,
    reason: getReason(status),
  };
}

function getStatus(params: {
  budgetChars: number;
  includedChars: number;
  trimmedChars: number;
}): PromptBudgetStatus {
  if (params.budgetChars === 0) {
    return "bypassed";
  }
  if (params.trimmedChars > 0) {
    return "trimmed";
  }
  return "included";
}

function getReason(status: PromptBudgetStatus): PromptBudgetReason {
  if (status === "bypassed") {
    return "zero-budget";
  }
  if (status === "trimmed") {
    return "section-over-budget";
  }
  return "within-budget";
}
