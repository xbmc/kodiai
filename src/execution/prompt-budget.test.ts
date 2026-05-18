import { describe, expect, test } from "bun:test";
import { evaluatePromptBudget } from "./prompt-budget.ts";

const baseSections = [
  { sectionName: "overview", text: "alpha" },
  { sectionName: "diff", text: "bravo" },
  { sectionName: "retrieval", text: "charlie" },
];

const baseBudgets = [
  { sectionName: "overview", budgetChars: 10 },
  { sectionName: "diff", budgetChars: 10 },
  { sectionName: "retrieval", budgetChars: 10 },
];

describe("evaluatePromptBudget", () => {
  test("keeps stable section ordering from input sections", () => {
    const result = evaluatePromptBudget({
      sections: baseSections,
      budgets: [...baseBudgets].reverse(),
      separator: "\n---\n",
    });

    expect(result.text).toBe("alpha\n---\nbravo\n---\ncharlie");
    expect(result.outcomes.map((outcome) => outcome.sectionName)).toEqual([
      "overview",
      "diff",
      "retrieval",
    ]);
    expect(result.outcomes.map((outcome) => outcome.sectionPosition)).toEqual([0, 1, 2]);
  });

  test("includes an exact-boundary section without marking it trimmed", () => {
    const result = evaluatePromptBudget({
      sections: [{ sectionName: "diff", text: "12345" }],
      budgets: [{ sectionName: "diff", budgetChars: 5 }],
    });

    expect(result.text).toBe("12345");
    expect(result.outcomes).toEqual([
      {
        sectionName: "diff",
        sectionPosition: 0,
        budgetChars: 5,
        budgetTokens: 2,
        includedChars: 5,
        includedTokens: 2,
        trimmedChars: 0,
        trimmedTokens: 0,
        status: "included",
        reason: "within-budget",
      },
    ]);
  });

  test("trims oversized sections and accounts for overflow deterministically", () => {
    const result = evaluatePromptBudget({
      sections: [{ sectionName: "retrieval", text: "abcdefghij" }],
      budgets: [{ sectionName: "retrieval", budgetChars: 6 }],
    });

    expect(result.text).toBe("abcdef");
    expect(result.outcomes[0]).toMatchObject({
      sectionName: "retrieval",
      budgetChars: 6,
      budgetTokens: 2,
      includedChars: 6,
      includedTokens: 2,
      trimmedChars: 4,
      trimmedTokens: 1,
      status: "trimmed",
      reason: "section-over-budget",
    });
  });

  test("bypasses zero-budget sections without leaving separator gaps", () => {
    const result = evaluatePromptBudget({
      sections: [
        { sectionName: "overview", text: "keep" },
        { sectionName: "expensive-context", text: "do not include" },
        { sectionName: "verdict", text: "finish" },
      ],
      budgets: [
        { sectionName: "overview", budgetChars: 10 },
        { sectionName: "expensive-context", budgetChars: 0 },
        { sectionName: "verdict", budgetChars: 10 },
      ],
      separator: "\n",
    });

    expect(result.text).toBe("keep\nfinish");
    expect(result.outcomes[1]).toMatchObject({
      sectionName: "expensive-context",
      budgetChars: 0,
      budgetTokens: 0,
      includedChars: 0,
      includedTokens: 0,
      trimmedChars: "do not include".length,
      trimmedTokens: 4,
      status: "bypassed",
      reason: "zero-budget",
    });
  });

  test("rejects invalid negative budgets", () => {
    expect(() => evaluatePromptBudget({
      sections: [{ sectionName: "diff", text: "abc" }],
      budgets: [{ sectionName: "diff", budgetChars: -1 }],
    })).toThrow("cannot be negative");
  });

  test("outcome objects do not leak raw section text", () => {
    const secretText = "SECRET_RAW_PROMPT_TEXT";
    const result = evaluatePromptBudget({
      sections: [{ sectionName: "sensitive", text: secretText }],
      budgets: [{ sectionName: "sensitive", budgetChars: 6 }],
    });

    expect(result.text).toBe("SECRET");
    expect(JSON.stringify(result.outcomes)).not.toContain(secretText);
    expect(JSON.stringify(result.outcomes)).not.toContain("SECRET");
    const outcome = result.outcomes[0];
    expect(outcome).toBeDefined();
    expect(Object.keys(outcome!).sort()).toEqual([
      "budgetChars",
      "budgetTokens",
      "includedChars",
      "includedTokens",
      "reason",
      "sectionName",
      "sectionPosition",
      "status",
      "trimmedChars",
      "trimmedTokens",
    ]);
  });
});
