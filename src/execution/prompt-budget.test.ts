import { describe, expect, test } from "bun:test";
import { evaluatePromptBudget, truncateToBudgetAtLineBoundary } from "./prompt-budget.ts";

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

describe("truncateToBudgetAtLineBoundary", () => {
  // Prompt sections are authored as ["## Heading", "", "body"], so a heading is followed
  // by a BLANK LINE. Fixtures must use that shape: an earlier version of this suite used
  // "## Heading\nbody" (single newline), which no real section produces, and it hid a
  // truncation bug that stranded headings in production prompts.
  const section = (heading: string, ...body: string[]) => [heading, "", ...body].join("\n");

  test("drops a trailing heading rather than leaving it without a body", () => {
    const text = [section("## Alpha", "alpha body line"), section("## Beta", "beta body line")].join("\n\n");
    // Budget that lands just past the "## Beta" heading but before its body.
    const budget = text.indexOf("beta body line") - 1;
    const out = truncateToBudgetAtLineBoundary(text, budget);

    expect(out).not.toContain("## Beta");
    expect(out).toContain("alpha body line");
    expect(out.endsWith("alpha body line")).toBe(true);
  });

  test("keeps partial lists instead of discarding the whole block", () => {
    // An over-budget file list should degrade to fewer files, not to nothing. Dropping
    // whole blank-line blocks collapsed a 140-file triage list to its bare heading.
    const files = Array.from({ length: 140 }, (_, index) => `- src/some/deep/path/file${index}.ts`);
    const text = section("### Full Review (140 files)", "Review these files thoroughly:", ...files);
    const out = truncateToBudgetAtLineBoundary(text, 2_400);

    expect(out.length).toBeLessThanOrEqual(2_400);
    expect(out.length).toBeGreaterThan(2_000);
    expect((out.match(/- src\//g) ?? []).length).toBeGreaterThan(50);
    // Complete lines only: never ends mid-path.
    expect(out.endsWith(".ts")).toBe(true);
  });

  test("returns the text unchanged when it already fits", () => {
    const text = section("## Alpha", "body");
    expect(truncateToBudgetAtLineBoundary(text, 10_000)).toBe(text);
  });

  test("falls back to a char slice when the first line alone exceeds the budget", () => {
    expect(truncateToBudgetAtLineBoundary("## OneVeryLongHeadingLine", 10)).toBe("## OneVeryL".slice(0, 10));
  });

  test("returns empty for a zero or negative budget", () => {
    expect(truncateToBudgetAtLineBoundary("## Alpha\n\nbody", 0)).toBe("");
    expect(truncateToBudgetAtLineBoundary("## Alpha\n\nbody", -5)).toBe("");
  });
});
