import { estimatePromptTokens } from "./prompt-section-metrics.ts";

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

    const includedText = section.text.slice(0, budget.budgetChars);
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
