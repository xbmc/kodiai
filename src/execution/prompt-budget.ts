import { estimatePromptTokens } from "./prompt-section-metrics.ts";

/**
 * Fit `text` into `budgetChars` by keeping whole lines, then dropping a trailing heading
 * that would be left with nothing under it.
 *
 * A raw `slice(0, budgetChars)` cuts wherever the character count runs out, so a section
 * can end mid-word or leave a heading with its body amputated. The model cannot detect
 * either: it reads the surviving prefix as a complete instruction. That is how the
 * verdict logic and severity template went missing from published reviews.
 *
 * Line boundaries rather than blank-line blocks, deliberately. Prompt sections are
 * authored as `["## Heading", "", "body"]`, so a blank-line block IS the bare heading --
 * dropping whole blocks both strands headings and discards most of the budget when one
 * block is large (a 140-file triage list collapsed to 27 of 2,400 chars, zero filenames).
 * Keeping lines preserves partial lists, which is what an over-budget file list should
 * degrade to, and the trailing-heading trim supplies the invariant that actually matters.
 *
 * Degenerate case: if nothing survives cleanly the result is empty rather than a
 * char-sliced fragment. A partial contract reads as complete and is worse than none.
 *
 * Which sections use this is declared by PromptSectionBudgetPolicy.truncation.
 */
export function truncateToBudgetAtLineBoundary(text: string, budgetChars: number): string {
  if (budgetChars <= 0) return "";
  if (text.length <= budgetChars) return text;

  const kept: string[] = [];
  let length = 0;
  for (const line of text.split("\n")) {
    const added = kept.length === 0 ? line.length : line.length + 1;
    if (length + added > budgetChars) break;
    kept.push(line);
    length += added;
  }

  // Headings are matched on the RAW line: an ATX heading starts at column 0, whereas an
  // indented "# ..." is content (a shell comment in a fence, or Markdown-in-Markdown).
  // Trimming first would delete those content lines and leave the fence unterminated.
  const isHeading = (line: string) => /^#{1,6}\s/.test(line);
  // A line ending in ":" introduces what follows. Keeping it after its content was cut
  // leaves an instruction pointing at a list that is not there -- undetectable to the
  // model in the same way a stranded heading is.
  const isLeadIn = (line: string) => /:\s*$/.test(line.trimEnd());

  // Fence tracking has to respect delimiter LENGTH. Prompt sections wrap yaml examples in
  // a 4-backtick fence containing a 3-backtick one; counting every ```-prefixed line as a
  // toggle makes that nest read as balanced, so a cut inside the outer wrapper emits an
  // unterminated block and the model parses following instructions as literal code.
  const hasOpenFence = (candidate: readonly string[]): boolean => {
    let open: string | null = null;
    for (const line of candidate) {
      const match = line.trimStart().match(/^(`{3,})/);
      if (!match) continue;
      const ticks = match[1]!;
      if (open === null) open = ticks;
      else if (ticks.length >= open.length) open = null;
    }
    return open !== null;
  };

  // Trim and fence-balance interact: popping to close a fence can expose a new trailing
  // heading or lead-in, so both run until the result stops changing. Running them once,
  // in sequence, left headings stranded after a fence pop.
  for (;;) {
    const before = kept.length;
    while (kept.length > 0) {
      const last = kept[kept.length - 1]!;
      if (last.trim() === "" || isHeading(last) || isLeadIn(last)) {
        kept.pop();
        continue;
      }
      break;
    }
    if (kept.length > 0 && hasOpenFence(kept)) {
      kept.pop();
      continue;
    }
    if (kept.length === before) break;
  }

  // Nothing survives cleanly. Emit nothing rather than a partial contract: an absent
  // instruction is recoverable, a truncated one reads as complete and is not. Reaching
  // here means the budget cannot hold one complete unit of this section, which is a
  // sizing bug in the caller -- the budget outcome still reports the section as trimmed.
  if (kept.length === 0) return "";
  return kept.join("\n");
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
   * "lines" keeps whole lines and drops a trailing heading left without a body. Correct
   * for sections carrying contracts the model must follow, where a char cut can end
   * mid-word or strand a heading and the model cannot tell the difference. That failure
   * silently removed the verdict logic and severity template from published reviews.
   */
  truncation?: "chars" | "lines";
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

    const includedText = budget.truncation === "lines"
      ? truncateToBudgetAtLineBoundary(section.text, budget.budgetChars)
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
