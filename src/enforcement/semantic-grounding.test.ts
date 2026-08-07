import { describe, expect, it } from "bun:test";
import {
  buildSemanticGroundingSourceIndex,
  enforceSemanticGrounding,
  SEMANTIC_GROUNDING_DOWNGRADE_TARGET,
  type SemanticGroundingLLM,
} from "./semantic-grounding.ts";
import type { FindingSeverity } from "../knowledge/types.ts";

// A realistic unified diff hunk touching src/foo.cpp lines 10-13 (post-change
// numbering), mirroring diff-grounding.test.ts's fixture so both gates agree
// on what's "in the diff".
const SAMPLE_DIFF = [
  "diff --git a/src/foo.cpp b/src/foo.cpp",
  "index 1111111..2222222 100644",
  "--- a/src/foo.cpp",
  "+++ b/src/foo.cpp",
  "@@ -8,3 +9,5 @@ void Foo::Bar()",
  " context line 9",
  "+  m_streaminfo = true;",
  "+}",
  " context line 12",
  " context line 13",
].join("\n");

function makeFinding(overrides: {
  filePath: string;
  severity: FindingSeverity;
  startLine?: number;
  endLine?: number;
  title?: string;
  reasoning?: string;
  groundingChecked?: boolean;
  groundingVerified?: boolean;
}) {
  return {
    filePath: overrides.filePath,
    severity: overrides.severity,
    title: overrides.title ?? "Some finding",
    ...(overrides.reasoning !== undefined ? { reasoning: overrides.reasoning } : {}),
    groundingChecked: overrides.groundingChecked ?? true,
    groundingVerified: overrides.groundingVerified ?? true,
    ...(overrides.startLine !== undefined ? { startLine: overrides.startLine } : {}),
    ...(overrides.endLine !== undefined ? { endLine: overrides.endLine } : {}),
  };
}

/** Stub LLM that always returns a fixed verdict line, recording every call it received. */
function stubLLM(response: string, calls: Array<{ prompt: string; system: string }> = []): SemanticGroundingLLM {
  return {
    generate: async (prompt: string, system: string) => {
      calls.push({ prompt, system });
      return response;
    },
  };
}

// ---------------------------------------------------------------------------
// buildSemanticGroundingSourceIndex
// ---------------------------------------------------------------------------
describe("buildSemanticGroundingSourceIndex", () => {
  it("indexes literal source text per post-change line", () => {
    const index = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const lines = index.get("src/foo.cpp");
    expect(lines).toBeDefined();
    expect(lines?.get(10)).toBe("  m_streaminfo = true;");
    expect(lines?.get(11)).toBe("}");
    expect(lines?.get(9)).toBe("context line 9");
  });

  it("returns an empty index for empty/missing diff text", () => {
    expect(buildSemanticGroundingSourceIndex("").size).toBe(0);
    expect(buildSemanticGroundingSourceIndex(null).size).toBe(0);
    expect(buildSemanticGroundingSourceIndex(undefined).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// enforceSemanticGrounding
// ---------------------------------------------------------------------------
describe("enforceSemanticGrounding", () => {
  it("is a no-op passthrough when disabled (default)", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const calls: Array<{ prompt: string; system: string }> = [];
    const llm = stubLLM("VERDICT: MISMATCH - test", calls);

    const [result] = await enforceSemanticGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 10, endLine: 11 })],
      sourceIndex,
      llm,
      // options omitted -> enabled defaults to false
    });

    expect(result?.severity).toBe("critical");
    expect(result?.semanticGroundingChecked).toBe(false);
    expect(result?.semanticGroundingReason).toBe("disabled");
    expect(calls).toHaveLength(0);
  });

  it("is a no-op passthrough when enabled but no LLM is supplied", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const [result] = await enforceSemanticGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 10, endLine: 11 })],
      sourceIndex,
      llm: null,
      options: { enabled: true },
    });

    expect(result?.severity).toBe("critical");
    expect(result?.semanticGroundingChecked).toBe(false);
    expect(result?.semanticGroundingReason).toBe("disabled");
  });

  it("downgrades a critical finding whose reasoning the LLM says mismatches the actual code", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const calls: Array<{ prompt: string; system: string }> = [];
    const llm = stubLLM("VERDICT: MISMATCH - the brace closes the function correctly, m_streaminfo is reachable", calls);

    const [result] = await enforceSemanticGrounding({
      findings: [makeFinding({
        filePath: "src/foo.cpp",
        severity: "critical",
        startLine: 10,
        endLine: 11,
        title: "Misplaced closing brace makes m_streaminfo=true unreachable",
      })],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(result?.severity).toBe(SEMANTIC_GROUNDING_DOWNGRADE_TARGET);
    expect(result?.preSemanticGroundingSeverity).toBe("critical");
    expect(result?.semanticGroundingChecked).toBe(true);
    expect(result?.semanticGroundingDowngraded).toBe(true);
    expect(result?.semanticGroundingReason).toBe("mismatch");
    expect(result?.semanticGroundingJustification).toContain("closes the function correctly");

    // The prompt should carry both the claim and the actual cited source text.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toContain("Misplaced closing brace");
    expect(calls[0]?.prompt).toContain("m_streaminfo = true;");
  });

  it("keeps a critical finding whose reasoning the LLM confirms matches the code", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const llm = stubLLM("VERDICT: MATCH - the code does exactly what the claim describes");

    const [result] = await enforceSemanticGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 10, endLine: 11 })],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(result?.severity).toBe("critical");
    expect(result?.semanticGroundingChecked).toBe(true);
    expect(result?.semanticGroundingDowngraded).toBe(false);
    expect(result?.semanticGroundingReason).toBe("matched");
  });

  it("fails open (keeps original severity) on an UNCERTAIN verdict", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const llm = stubLLM("VERDICT: UNCERTAIN - not enough context to judge");

    const [result] = await enforceSemanticGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "major", startLine: 10, endLine: 11 })],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(result?.severity).toBe("major");
    expect(result?.semanticGroundingChecked).toBe(true);
    expect(result?.semanticGroundingDowngraded).toBe(false);
    expect(result?.semanticGroundingReason).toBe("uncertain");
  });

  it("fails open on an unparsable LLM response", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const llm = stubLLM("I refuse to answer in the requested format.");

    const [result] = await enforceSemanticGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 10, endLine: 11 })],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(result?.severity).toBe("critical");
    expect(result?.semanticGroundingDowngraded).toBe(false);
    expect(result?.semanticGroundingReason).toBe("uncertain");
  });

  it("fails open (never downgrades) when the LLM call throws", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const throwingLLM: SemanticGroundingLLM = {
      generate: async () => {
        throw new Error("network timeout");
      },
    };

    const [result] = await enforceSemanticGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 10, endLine: 11 })],
      sourceIndex,
      llm: throwingLLM,
      options: { enabled: true },
      logger: { warn: () => {}, info: () => {} },
    });

    expect(result?.severity).toBe("critical");
    expect(result?.semanticGroundingDowngraded).toBe(false);
    expect(result?.semanticGroundingReason).toBe("llm-error");
  });

  it("never drops a finding -- downgraded findings remain in the output array", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const llm = stubLLM("VERDICT: MISMATCH - wrong");

    const results = await enforceSemanticGrounding({
      findings: [
        makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 10, endLine: 11 }),
        makeFinding({ filePath: "src/foo.cpp", severity: "major", startLine: 12, endLine: 12 }),
      ],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(results).toHaveLength(2);
  });

  it("skips findings that were not verified by diff-grounding (already downgraded or unchecked)", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const calls: Array<{ prompt: string; system: string }> = [];
    const llm = stubLLM("VERDICT: MISMATCH - wrong", calls);

    const [result] = await enforceSemanticGrounding({
      findings: [makeFinding({
        filePath: "src/foo.cpp",
        severity: "critical",
        startLine: 10,
        endLine: 11,
        groundingChecked: true,
        groundingVerified: false, // diff-grounding already downgraded this one
      })],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(result?.semanticGroundingChecked).toBe(false);
    expect(result?.semanticGroundingReason).toBe("not-applicable");
    expect(calls).toHaveLength(0);
  });

  it("does not check minor/medium findings", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const calls: Array<{ prompt: string; system: string }> = [];
    const llm = stubLLM("VERDICT: MISMATCH - wrong", calls);

    const [result] = await enforceSemanticGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "minor", startLine: 10, endLine: 11 })],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(result?.severity).toBe("minor");
    expect(result?.semanticGroundingChecked).toBe(false);
    expect(result?.semanticGroundingReason).toBe("not-applicable");
    expect(calls).toHaveLength(0);
  });

  it("skips findings without reasoning text (empty title)", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const calls: Array<{ prompt: string; system: string }> = [];
    const llm = stubLLM("VERDICT: MISMATCH - wrong", calls);

    const [result] = await enforceSemanticGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 10, endLine: 11, title: "" })],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(result?.semanticGroundingChecked).toBe(false);
    expect(result?.semanticGroundingReason).toBe("no-reasoning");
    expect(calls).toHaveLength(0);
  });

  it("skips findings whose cited source text is unavailable in the index", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const calls: Array<{ prompt: string; system: string }> = [];
    const llm = stubLLM("VERDICT: MISMATCH - wrong", calls);

    const [result] = await enforceSemanticGrounding({
      findings: [makeFinding({ filePath: "src/other-file-not-in-diff.cpp", severity: "critical", startLine: 10, endLine: 11 })],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(result?.semanticGroundingChecked).toBe(false);
    expect(result?.semanticGroundingReason).toBe("source-unavailable");
    expect(calls).toHaveLength(0);
  });

  it("caps the number of findings sent to the LLM at maxFindingsToCheck", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const calls: Array<{ prompt: string; system: string }> = [];
    const llm = stubLLM("VERDICT: MATCH - fine", calls);

    const findings = Array.from({ length: 5 }, (_, i) =>
      makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 10, endLine: 11, title: `Finding ${i}` }));

    const results = await enforceSemanticGrounding({
      findings,
      sourceIndex,
      llm,
      options: { enabled: true, maxFindingsToCheck: 2 },
    });

    expect(calls).toHaveLength(2);
    const checkedCount = results.filter((r) => r.semanticGroundingChecked).length;
    const budgetExceededCount = results.filter((r) => r.semanticGroundingReason === "budget-exceeded").length;
    expect(checkedCount).toBe(2);
    expect(budgetExceededCount).toBe(3);
    // Budget-exceeded findings are never downgraded -- fail open.
    for (const result of results) {
      if (result.semanticGroundingReason === "budget-exceeded") {
        expect(result.severity).toBe("critical");
      }
    }
  });

  it("preserves unrelated finding fields", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const llm = stubLLM("VERDICT: MATCH - fine");

    const [result] = await enforceSemanticGrounding({
      findings: [{
        filePath: "src/foo.cpp",
        severity: "critical" as FindingSeverity,
        startLine: 10,
        endLine: 11,
        title: "Some finding",
        category: "correctness",
        groundingChecked: true,
        groundingVerified: true,
      }],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(result?.category).toBe("correctness");
  });

  it("fact-checks the finding's reasoning, not its one-line title, when reasoning is present", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const calls: Array<{ prompt: string; system: string }> = [];
    const llm = stubLLM("VERDICT: MATCH - fine", calls);

    await enforceSemanticGrounding({
      findings: [makeFinding({
        filePath: "src/foo.cpp",
        severity: "critical",
        startLine: 10,
        endLine: 11,
        title: "Race condition in job cleanup",
        reasoning: "m_streaminfo is assigned without holding the section lock, so a concurrent reader can observe a torn value.",
      })],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toContain("without holding the section lock");
    // The summary-only hedge must be absent when real reasoning was supplied.
    expect(calls[0]?.prompt).not.toContain("one-line finding summary");
  });

  it("caps an unbounded reasoning body so prompt cost stays bounded", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const calls: Array<{ prompt: string; system: string }> = [];
    const llm = stubLLM("VERDICT: MATCH - fine", calls);

    await enforceSemanticGrounding({
      findings: [makeFinding({
        filePath: "src/foo.cpp",
        severity: "critical",
        startLine: 10,
        endLine: 11,
        reasoning: `LEAD CLAIM. ${"padding ".repeat(2000)}TAIL MARKER`,
      })],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toContain("LEAD CLAIM.");
    expect(calls[0]?.prompt).toContain("[truncated]");
    expect(calls[0]?.prompt).not.toContain("TAIL MARKER");
  });

  it("tells the grader it is judging a summary when only a title is available", async () => {
    const sourceIndex = buildSemanticGroundingSourceIndex(SAMPLE_DIFF);
    const calls: Array<{ prompt: string; system: string }> = [];
    const llm = stubLLM("VERDICT: MATCH - fine", calls);

    await enforceSemanticGrounding({
      findings: [makeFinding({
        filePath: "src/foo.cpp",
        severity: "critical",
        startLine: 10,
        endLine: 11,
        title: "Race condition in job cleanup",
      })],
      sourceIndex,
      llm,
      options: { enabled: true },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toContain("one-line finding summary");
    expect(calls[0]?.prompt).toContain("merely terse");
  });
});
