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

  test("emits nothing rather than a partial contract when nothing survives cleanly", () => {
    // Previously this fell back to text.slice(), which returned a stranded heading with a
    // mid-word body cut -- reintroducing the exact failure this function exists to stop.
    const text = section("## Bounded Review Disclosure", "Because this review was bounded, include this sentence.");
    expect(truncateToBudgetAtLineBoundary(text, 40)).toBe("");
    expect(truncateToBudgetAtLineBoundary("## OneVeryLongHeadingLine", 10)).toBe("");
  });

  test("does not mistake an indented '#' content line for a heading", () => {
    // A shell comment inside a fence starts with '#' once trimmed. Popping it as a
    // heading deletes real content and leaves the fence unterminated.
    const text = ["## Example", "", "```bash", "bun test", "# run bun test before pushing", "```"].join("\n");
    const out = truncateToBudgetAtLineBoundary(text, text.length - 4);
    expect((out.match(/```/g) ?? []).length % 2).toBe(0);
  });

  test("drops a trailing lead-in whose content was truncated away", () => {
    // "Review these files thoroughly:" with no files under it instructs the model to
    // review a list that is not present, which it cannot detect.
    const text = section("### Full Review (140 files)", "Review these files thoroughly:", "- a.ts", "- b.ts");
    const budget = section("### Full Review (140 files)", "Review these files thoroughly:").length + 1;
    const out = truncateToBudgetAtLineBoundary(text, budget);
    expect(out.trimEnd().endsWith(":")).toBe(false);
  });

  test("re-trims after closing a fence so no heading is left stranded", () => {
    // The fence-balance pop can expose a new trailing heading. Running the trims once in
    // sequence left "## Foo" as the last line with nothing under it.
    const out = truncateToBudgetAtLineBoundary("intro line here\n\n## Foo\n\n```\ncode one\ncode two", 35);
    expect(out.trimEnd().endsWith("## Foo")).toBe(false);
    expect(out).toBe("intro line here");
  });

  test("respects fence delimiter length so nested fences are not miscounted", () => {
    // buildModeInstructions wraps a ```yaml example in a ```` fence. Counting every
    // ```-prefixed line as one toggle makes that nest read as balanced, so a cut inside
    // the outer wrapper emitted an unterminated block and the model parsed the following
    // instructions as literal code.
    const out = truncateToBudgetAtLineBoundary("````\n```yaml\na: 1\n```\n````\ntail", 20);
    expect(out).toBe("");
  });

  test("does not treat a fence info string as a closing delimiter", () => {
    // An opening ```yaml line is not a closer. Treating every backtick-prefixed line
    // as one made an unterminated YAML example look balanced after truncation.
    const out = truncateToBudgetAtLineBoundary("intro line here\n\n```\nkey: value\n```yaml\nmore: content", 43);
    expect(out).toBe("intro line here");
  });

  test("returns empty for a zero or negative budget", () => {
    expect(truncateToBudgetAtLineBoundary("## Alpha\n\nbody", 0)).toBe("");
    expect(truncateToBudgetAtLineBoundary("## Alpha\n\nbody", -5)).toBe("");
  });
});
