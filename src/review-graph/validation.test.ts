/**
 * validation.test.ts
 *
 * Tests for graph-amplified finding validation and trivial-change bypass.
 */

import { describe, it, expect, mock } from "bun:test";
import type { Logger } from "pino";
import {
  validateGraphAmplifiedFindings,
  isTrivialChange,
  type GraphValidationFinding,
  type ValidationLLM,
} from "./validation.ts";
import type { ReviewGraphBlastRadiusResult } from "./query.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noopLogger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
} as unknown as Logger;

function makeBlastRadius(overrides: Partial<ReviewGraphBlastRadiusResult> = {}): ReviewGraphBlastRadiusResult {
  return {
    changedFiles: ["src/foo.ts"],
    seedSymbols: [],
    impactedFiles: [
      { path: "src/bar.ts", score: 0.9, confidence: 0.85, reasons: ["calls changed symbol"], relatedChangedPaths: ["src/foo.ts"], languages: ["TypeScript"] },
    ],
    probableDependents: [
      { stableKey: "baz:sym", symbolName: "bazFn", qualifiedName: "baz.bazFn", filePath: "src/baz.ts", score: 0.7, confidence: 0.6, reasons: ["calls changed symbol"], relatedChangedPaths: ["src/foo.ts"] },
    ],
    likelyTests: [
      { path: "src/foo.test.ts", score: 0.8, confidence: 0.75, reasons: ["test heuristic"], relatedChangedPaths: ["src/foo.ts"], languages: ["TypeScript"], testSymbols: ["testFoo"] },
    ],
    graphStats: { files: 10, nodes: 30, edges: 50, changedFilesFound: 1 },
    ...overrides,
  };
}

function makeFinding(id: number, filePath: string): GraphValidationFinding {
  return { id, filePath, title: `Finding #${id}`, severity: "major" };
}

function makeConfirmingLLM(): ValidationLLM {
  return {
    generate: async (prompt: string) => {
      const count = (prompt.match(/^\d+\./gm) ?? []).length;
      return Array.from({ length: count }, (_, i) => `${i + 1}: CONFIRMED`).join("\n");
    },
  };
}

function makeUncertainLLM(): ValidationLLM {
  return {
    generate: async (prompt: string) => {
      const count = (prompt.match(/^\d+\./gm) ?? []).length;
      return Array.from({ length: count }, (_, i) => `${i + 1}: UNCERTAIN`).join("\n");
    },
  };
}

function makeThrowingLLM(): ValidationLLM {
  return {
    generate: async () => {
      throw new Error("LLM unavailable");
    },
  };
}

// ---------------------------------------------------------------------------
// isTrivialChange
// ---------------------------------------------------------------------------

describe("isTrivialChange", () => {
  it("returns bypass=true when file count is at or below threshold (default 3)", () => {
    expect(isTrivialChange({ changedFileCount: 1 }).bypass).toBe(true);
    expect(isTrivialChange({ changedFileCount: 2 }).bypass).toBe(true);
    expect(isTrivialChange({ changedFileCount: 3 }).bypass).toBe(true);
  });

  it("returns bypass=false when file count exceeds default threshold", () => {
    expect(isTrivialChange({ changedFileCount: 4 }).bypass).toBe(false);
    expect(isTrivialChange({ changedFileCount: 50 }).bypass).toBe(false);
  });

  it("respects custom trivialFileThreshold", () => {
    const opts = { trivialFileThreshold: 1 };
    expect(isTrivialChange({ changedFileCount: 1, options: opts }).bypass).toBe(true);
    expect(isTrivialChange({ changedFileCount: 2, options: opts }).bypass).toBe(false);
  });

  it("returns bypass=true when line threshold met (when configured)", () => {
    const opts = { trivialFileThreshold: 3, trivialLineThreshold: 20 };
    // File count too high but lines are tiny
    expect(isTrivialChange({ changedFileCount: 4, totalLinesChanged: 15, options: opts }).bypass).toBe(true);
  });

  it("ignores line threshold when set to 0 (default)", () => {
    // Even with very few lines, bypass is driven by file count
    const res = isTrivialChange({ changedFileCount: 10, totalLinesChanged: 1 });
    expect(res.bypass).toBe(false);
  });

  it("returns bypass=false for zero files (fail-closed)", () => {
    expect(isTrivialChange({ changedFileCount: 0 }).bypass).toBe(false);
  });

  it("includes reason in result", () => {
    const { reason } = isTrivialChange({ changedFileCount: 2 });
    expect(reason).toContain("file-count");
    expect(reason).toContain("threshold");

    const { reason: r2 } = isTrivialChange({ changedFileCount: 10 });
    expect(r2).toBe("non-trivial");
  });
});

// ---------------------------------------------------------------------------
// validateGraphAmplifiedFindings — disabled / bypass paths
// ---------------------------------------------------------------------------

describe("validateGraphAmplifiedFindings — disabled", () => {
  it("returns all findings with graphValidated=false when disabled (default)", async () => {
    const findings = [makeFinding(1, "src/bar.ts"), makeFinding(2, "src/foo.ts")];
    const blastRadius = makeBlastRadius();
    const llm = makeConfirmingLLM();

    const result = await validateGraphAmplifiedFindings(findings, blastRadius, llm, {}, noopLogger);

    expect(result.succeeded).toBe(true);
    expect(result.validatedCount).toBe(0);
    expect(result.findings).toHaveLength(2);
    for (const f of result.findings) {
      expect(f.graphValidated).toBe(false);
      expect(f.graphValidationVerdict).toBe("skipped");
    }
  });

  it("returns passthrough when blastRadius is null", async () => {
    const findings = [makeFinding(1, "src/bar.ts")];
    const result = await validateGraphAmplifiedFindings(findings, null, makeConfirmingLLM(), { enabled: true }, noopLogger);

    expect(result.succeeded).toBe(true);
    expect(result.validatedCount).toBe(0);
    expect(result.findings[0]!.graphValidated).toBe(false);
  });

  it("returns passthrough when llm is null", async () => {
    const findings = [makeFinding(1, "src/bar.ts")];
    const blastRadius = makeBlastRadius();
    const result = await validateGraphAmplifiedFindings(findings, blastRadius, null, { enabled: true }, noopLogger);

    expect(result.succeeded).toBe(true);
    expect(result.validatedCount).toBe(0);
    expect(result.findings[0]!.graphValidated).toBe(false);
  });

  it("returns passthrough when no graph-amplified files match findings", async () => {
    // Only finding on directly changed file
    const findings = [makeFinding(1, "src/foo.ts")];
    const blastRadius = makeBlastRadius(); // changedFiles includes src/foo.ts
    const result = await validateGraphAmplifiedFindings(findings, blastRadius, makeConfirmingLLM(), { enabled: true }, noopLogger);

    expect(result.succeeded).toBe(true);
    expect(result.validatedCount).toBe(0);
    expect(result.findings[0]!.graphValidated).toBe(false);
    expect(result.findings[0]!.graphValidationVerdict).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// validateGraphAmplifiedFindings — active validation
// ---------------------------------------------------------------------------

describe("validateGraphAmplifiedFindings — active", () => {
  it("validates findings on impacted files with confirming LLM", async () => {
    const findings = [
      makeFinding(1, "src/bar.ts"),  // graph-amplified
      makeFinding(2, "src/foo.ts"),  // directly changed
    ];
    const blastRadius = makeBlastRadius();

    const result = await validateGraphAmplifiedFindings(
      findings,
      blastRadius,
      makeConfirmingLLM(),
      { enabled: true },
      noopLogger,
    );

    expect(result.succeeded).toBe(true);
    expect(result.validatedCount).toBe(1);
    expect(result.confirmedCount).toBe(1);
    expect(result.uncertainCount).toBe(0);

    const barFinding = result.findings.find((f) => f.filePath === "src/bar.ts")!;
    expect(barFinding.graphValidated).toBe(true);
    expect(barFinding.graphValidationVerdict).toBe("confirmed");

    const fooFinding = result.findings.find((f) => f.filePath === "src/foo.ts")!;
    expect(fooFinding.graphValidated).toBe(false);
    expect(fooFinding.graphValidationVerdict).toBe("skipped");
  });

  it("validates findings on probable dependent files", async () => {
    const findings = [makeFinding(1, "src/baz.ts")]; // in probableDependents
    const blastRadius = makeBlastRadius();

    const result = await validateGraphAmplifiedFindings(
      findings,
      blastRadius,
      makeUncertainLLM(),
      { enabled: true },
      noopLogger,
    );

    expect(result.succeeded).toBe(true);
    expect(result.validatedCount).toBe(1);
    expect(result.confirmedCount).toBe(0);
    expect(result.uncertainCount).toBe(1);

    expect(result.findings[0]!.graphValidated).toBe(true);
    expect(result.findings[0]!.graphValidationVerdict).toBe("uncertain");
  });

  it("validates findings on likely test files", async () => {
    const findings = [makeFinding(1, "src/foo.test.ts")]; // in likelyTests
    const blastRadius = makeBlastRadius();

    const result = await validateGraphAmplifiedFindings(
      findings,
      blastRadius,
      makeConfirmingLLM(),
      { enabled: true },
      noopLogger,
    );

    expect(result.succeeded).toBe(true);
    expect(result.validatedCount).toBe(1);
    expect(result.confirmedCount).toBe(1);
  });

  it("caps validation at maxFindingsToValidate", async () => {
    // 5 findings all on graph-amplified files
    const blastRadius = makeBlastRadius({
      impactedFiles: Array.from({ length: 5 }, (_, i) => ({
        path: `src/imp${i}.ts`,
        score: 0.8,
        confidence: 0.8,
        reasons: ["calls changed symbol"],
        relatedChangedPaths: ["src/foo.ts"],
        languages: ["TypeScript"],
      })),
    });
    const findings = Array.from({ length: 5 }, (_, i) => makeFinding(i + 1, `src/imp${i}.ts`));

    const result = await validateGraphAmplifiedFindings(
      findings,
      blastRadius,
      makeConfirmingLLM(),
      { enabled: true, maxFindingsToValidate: 2 },
      noopLogger,
    );

    expect(result.succeeded).toBe(true);
    expect(result.validatedCount).toBe(2);
    // Remaining 3 should be skipped (not validated)
    const validatedCount = result.findings.filter((f) => f.graphValidated).length;
    expect(validatedCount).toBe(2);
    const skippedCount = result.findings.filter((f) => !f.graphValidated).length;
    expect(skippedCount).toBe(3);
  });

  it("preserves original finding fields in output", async () => {
    type ExtendedFinding = GraphValidationFinding & { extra: string };
    const findings: ExtendedFinding[] = [
      { id: 1, filePath: "src/bar.ts", title: "T1", severity: "critical", extra: "custom-data" },
    ];
    const blastRadius = makeBlastRadius();

    const result = await validateGraphAmplifiedFindings<ExtendedFinding>(
      findings,
      blastRadius,
      makeConfirmingLLM(),
      { enabled: true },
      noopLogger,
    );

    expect(result.findings[0]!.extra).toBe("custom-data");
    expect(result.findings[0]!.title).toBe("T1");
    expect(result.findings[0]!.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// validateGraphAmplifiedFindings — fail-open paths
// ---------------------------------------------------------------------------

describe("validateGraphAmplifiedFindings — fail-open", () => {
  it("returns original findings with succeeded=false when LLM throws", async () => {
    const findings = [makeFinding(1, "src/bar.ts")];
    const blastRadius = makeBlastRadius();

    const result = await validateGraphAmplifiedFindings(
      findings,
      blastRadius,
      makeThrowingLLM(),
      { enabled: true },
      noopLogger,
    );

    expect(result.succeeded).toBe(false);
    expect(result.errorMessage).toBeTruthy();
    expect(result.validatedCount).toBe(0);
    // Original findings returned unchanged
    expect(result.findings[0]!.graphValidated).toBe(false);
    expect(result.findings[0]!.graphValidationVerdict).toBe("skipped");
  });

  it("returns original findings when LLM returns unparseable response", async () => {
    const badLLM: ValidationLLM = {
      generate: async () => "this is not a valid format at all",
    };
    const findings = [makeFinding(1, "src/bar.ts")];
    const blastRadius = makeBlastRadius();

    const result = await validateGraphAmplifiedFindings(
      findings,
      blastRadius,
      badLLM,
      { enabled: true },
      noopLogger,
    );

    // Should succeed (no throw), but verdicts default to "uncertain"
    expect(result.succeeded).toBe(true);
    expect(result.validatedCount).toBe(1);
    expect(result.findings[0]!.graphValidated).toBe(true);
    // No parseable verdict → defaults to "uncertain"
    expect(result.findings[0]!.graphValidationVerdict).toBe("uncertain");
  });

  it("returns passthrough when blast radius has empty amplified set", async () => {
    const blastRadius = makeBlastRadius({
      impactedFiles: [],
      probableDependents: [],
      likelyTests: [],
    });
    const findings = [makeFinding(1, "src/foo.ts")]; // only changed file

    const result = await validateGraphAmplifiedFindings(
      findings,
      blastRadius,
      makeConfirmingLLM(),
      { enabled: true },
      noopLogger,
    );

    expect(result.succeeded).toBe(true);
    expect(result.validatedCount).toBe(0);
  });

  it("never throws externally — wraps all errors", async () => {
    const crashLLM: ValidationLLM = {
      // This should be caught inside the function
      generate: () => { throw new TypeError("crash"); },
    };

    const findings = [makeFinding(1, "src/bar.ts")];
    const blastRadius = makeBlastRadius();

    // Should not throw
    const result = await validateGraphAmplifiedFindings(
      findings,
      blastRadius,
      crashLLM,
      { enabled: true },
      noopLogger,
    );

    expect(result.findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("validateGraphAmplifiedFindings — edge cases", () => {
  it("handles empty findings array", async () => {
    const blastRadius = makeBlastRadius();
    const result = await validateGraphAmplifiedFindings([], blastRadius, makeConfirmingLLM(), { enabled: true }, noopLogger);

    expect(result.findings).toHaveLength(0);
    expect(result.validatedCount).toBe(0);
    expect(result.succeeded).toBe(true);
  });

  it("handles blast radius with no impacted files", async () => {
    const blastRadius = makeBlastRadius({ impactedFiles: [], probableDependents: [], likelyTests: [] });
    const findings = [makeFinding(1, "src/foo.ts")];
    const result = await validateGraphAmplifiedFindings(findings, blastRadius, makeConfirmingLLM(), { enabled: true }, noopLogger);

    expect(result.validatedCount).toBe(0);
    expect(result.succeeded).toBe(true);
  });

  it("does not validate findings on files that are both changed AND in impactedFiles", async () => {
    // src/foo.ts is in changedFiles — should NOT be treated as graph-amplified even if impactedFiles also lists it
    const blastRadius = makeBlastRadius({
      impactedFiles: [
        { path: "src/foo.ts", score: 0.9, confidence: 0.9, reasons: ["self"], relatedChangedPaths: ["src/foo.ts"], languages: ["TypeScript"] },
      ],
    });
    const findings = [makeFinding(1, "src/foo.ts")];
    const result = await validateGraphAmplifiedFindings(findings, blastRadius, makeConfirmingLLM(), { enabled: true }, noopLogger);

    expect(result.validatedCount).toBe(0);
    expect(result.findings[0]!.graphValidated).toBe(false);
    expect(result.findings[0]!.graphValidationVerdict).toBe("skipped");
  });

  it("handles mixed findings — some on changed files, some on graph-amplified", async () => {
    const findings = [
      makeFinding(1, "src/foo.ts"),   // directly changed
      makeFinding(2, "src/bar.ts"),   // graph-amplified (impacted)
      makeFinding(3, "src/baz.ts"),   // graph-amplified (dependent)
    ];
    const blastRadius = makeBlastRadius();

    const result = await validateGraphAmplifiedFindings(
      findings,
      blastRadius,
      makeConfirmingLLM(),
      { enabled: true },
      noopLogger,
    );

    expect(result.succeeded).toBe(true);
    expect(result.validatedCount).toBe(2);

    const f1 = result.findings[0]!;
    expect(f1.graphValidated).toBe(false);
    expect(f1.graphValidationVerdict).toBe("skipped");

    const f2 = result.findings[1]!;
    expect(f2.graphValidated).toBe(true);
    expect(f2.graphValidationVerdict).toBe("confirmed");

    const f3 = result.findings[2]!;
    expect(f3.graphValidated).toBe(true);
    expect(f3.graphValidationVerdict).toBe("confirmed");
  });
});
