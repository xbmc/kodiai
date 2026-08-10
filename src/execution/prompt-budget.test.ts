import { describe, expect, test } from "bun:test";
import { evaluatePromptBudget, truncateToBudgetByBlocks } from "./prompt-budget.ts";

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

describe("truncateToBudgetByBlocks", () => {
  const blocks = (...parts: string[]) => parts.join("\n\n");

  test("keeps whole blocks and never strands a heading without its body", () => {
    const text = blocks("## Alpha\nbody one", "## Beta\nbody two", "## Gamma\nbody three");
    const out = truncateToBudgetByBlocks(text, 40);

    expect(out.length).toBeLessThanOrEqual(40);
    // Whatever survives is complete: no heading appears without the body under it.
    for (const heading of ["## Alpha", "## Beta", "## Gamma"]) {
      if (out.includes(heading)) {
        expect(out.split(heading)[1]!.trim().length).toBeGreaterThan(0);
      }
    }
    // Stops exactly on a block boundary: the first two blocks fit (35 chars), the third
    // would not (55). A raw slice at the same budget lands mid-block instead.
    expect(out).toBe(blocks("## Alpha\nbody one", "## Beta\nbody two"));
    expect(text.startsWith(out)).toBe(true);
    expect(text.slice(0, 40)).not.toBe(out);
  });

  test("returns the text unchanged when it already fits", () => {
    const text = blocks("## Alpha\nbody", "## Beta\nbody");
    expect(truncateToBudgetByBlocks(text, 10_000)).toBe(text);
  });

  test("falls back to a char slice when the first block alone exceeds the budget", () => {
    // Nothing to drop, so the cut is unavoidable. Callers in this state have a sizing
    // problem the block strategy cannot paper over.
    expect(truncateToBudgetByBlocks("## OnlyOneVeryLongBlock body", 10)).toBe("## OnlyOne");
  });

  test("returns empty for a zero or negative budget", () => {
    expect(truncateToBudgetByBlocks("## Alpha\nbody", 0)).toBe("");
    expect(truncateToBudgetByBlocks("## Alpha\nbody", -5)).toBe("");
  });
});
