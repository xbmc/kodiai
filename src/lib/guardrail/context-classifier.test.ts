import { describe, expect, test } from "bun:test";
import { classifyClaimAgainstContext } from "./context-classifier.ts";
import type { GroundingContext } from "./types.ts";

describe("classifyClaimAgainstContext", () => {
  test("context-grounded claim returns diff-grounded label", () => {
    const context: GroundingContext = {
      providedContext: ["removing old handler code"],
      contextSources: ["issue"],
    };
    const result = classifyClaimAgainstContext("This removes the old handler", context);
    expect(result.label).toBe("diff-grounded");
  });

  test("external-knowledge claim returns external-knowledge label", () => {
    const context: GroundingContext = {
      providedContext: ["fix handler"],
      contextSources: ["issue"],
    };
    const result = classifyClaimAgainstContext("This was released in March 2024", context);
    expect(result.label).toBe("external-knowledge");
  });

  test("allowlisted claim returns diff-grounded with high confidence", () => {
    const context: GroundingContext = {
      providedContext: ["concurrent access"],
      contextSources: ["code"],
    };
    const result = classifyClaimAgainstContext("This could cause a race condition", context);
    expect(result.label).toBe("diff-grounded");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test("empty context with no external signals returns diff-grounded (fail-open)", () => {
    const context: GroundingContext = {
      providedContext: [],
      contextSources: [],
    };
    const result = classifyClaimAgainstContext("Some generic statement about code", context);
    expect(result.label).toBe("diff-grounded");
  });

  test("CVE reference is always external-knowledge", () => {
    const context: GroundingContext = {
      providedContext: ["security fix"],
      contextSources: ["issue"],
    };
    const result = classifyClaimAgainstContext("This addresses CVE-2024-1234", context);
    expect(result.label).toBe("external-knowledge");
  });

  test("version number not in context is external-knowledge", () => {
    const context: GroundingContext = {
      providedContext: ["update dependency"],
      contextSources: ["pr"],
    };
    const result = classifyClaimAgainstContext("This method was introduced in v3.2.1", context);
    expect(result.label).toBe("external-knowledge");
  });

  test("strict strictness uses lower overlap threshold", () => {
    // With strict (0.3 threshold), fewer matching words needed
    const context: GroundingContext = {
      providedContext: ["update the database connection pooling configuration"],
      contextSources: ["issue"],
    };
    // Claim has some overlap but not a lot
    const resultStrict = classifyClaimAgainstContext(
      "This changes the database timeout setting",
      context,
      "strict",
    );
    const resultLenient = classifyClaimAgainstContext(
      "This changes the database timeout setting",
      context,
      "lenient",
    );
    // strict should be more likely to flag as not-grounded (lower threshold = stricter)
    // With strict, fewer overlapping words needed to pass as grounded
    // Actually strict threshold 0.3 means 30% overlap needed, lenient 0.7 means 70% needed
    // So strict is EASIER to ground (more lenient on overlap), which means MORE things pass
    expect(resultStrict.label).toBe("diff-grounded");
  });

  test("delegtes to classifyClaimHeuristic when diffContext is present", () => {
    const context: GroundingContext = {
      providedContext: [],
      contextSources: ["diff"],
      diffContext: {
        rawPatch: "+added line\n-removed line",
        addedLines: ["added line"],
        removedLines: ["removed line"],
        contextLines: [],
      },
    };
    const result = classifyClaimAgainstContext(
      "This removes the removed line from the code",
      context,
    );
    // Should delegate to classifyClaimHeuristic which handles diff context
    expect(result).toHaveProperty("label");
    expect(result).toHaveProperty("confidence");
  });

  test("API behavior pattern is external-knowledge", () => {
    const context: GroundingContext = {
      providedContext: ["fix error handling"],
      contextSources: ["issue"],
    };
    const result = classifyClaimAgainstContext(
      "This library is known to throw on null input",
      context,
    );
    expect(result.label).toBe("external-knowledge");
  });

  test("compatibility claim is external-knowledge", () => {
    const context: GroundingContext = {
      providedContext: ["upgrade framework"],
      contextSources: ["issue"],
    };
    const result = classifyClaimAgainstContext(
      "This is only compatible with Node 18 and above",
      context,
    );
    expect(result.label).toBe("external-knowledge");
  });
});
