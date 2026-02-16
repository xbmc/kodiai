import { describe, expect, test } from "bun:test";
import { buildPriorFindingContext, shouldSuppressFinding } from "./finding-dedup.ts";
import type { PriorFinding } from "../knowledge/types.ts";

function makeFinding(overrides: Partial<PriorFinding> = {}): PriorFinding {
  return {
    filePath: "src/app.ts",
    title: "Unused variable detected",
    titleFingerprint: "fp-aabb0011",
    severity: "minor",
    category: "style",
    startLine: 10,
    endLine: 12,
    commentId: 100,
    ...overrides,
  };
}

describe("buildPriorFindingContext", () => {
  test("returns empty context when no prior findings", () => {
    const result = buildPriorFindingContext({
      priorFindings: [],
      changedFilesSinceLastReview: ["src/app.ts"],
    });

    expect(result.unresolvedOnUnchangedCode).toEqual([]);
    expect(result.suppressionFingerprints.size).toBe(0);
  });

  test("findings on unchanged files are added to unresolvedOnUnchangedCode", () => {
    const finding = makeFinding({ filePath: "src/utils.ts" });
    const result = buildPriorFindingContext({
      priorFindings: [finding],
      changedFilesSinceLastReview: ["src/app.ts"], // utils.ts not changed
    });

    expect(result.unresolvedOnUnchangedCode).toHaveLength(1);
    expect(result.unresolvedOnUnchangedCode[0]).toEqual(finding);
  });

  test("findings on changed files are excluded from context", () => {
    const findingOnChanged = makeFinding({ filePath: "src/app.ts" });
    const findingOnUnchanged = makeFinding({
      filePath: "src/utils.ts",
      titleFingerprint: "fp-ccdd0022",
    });

    const result = buildPriorFindingContext({
      priorFindings: [findingOnChanged, findingOnUnchanged],
      changedFilesSinceLastReview: ["src/app.ts"],
    });

    expect(result.unresolvedOnUnchangedCode).toHaveLength(1);
    expect(result.unresolvedOnUnchangedCode[0]!.filePath).toBe("src/utils.ts");
  });

  test("suppressionFingerprints contains filePath:titleFingerprint for unchanged-file findings", () => {
    const finding1 = makeFinding({
      filePath: "src/utils.ts",
      titleFingerprint: "fp-11110000",
    });
    const finding2 = makeFinding({
      filePath: "src/helpers.ts",
      titleFingerprint: "fp-22220000",
    });

    const result = buildPriorFindingContext({
      priorFindings: [finding1, finding2],
      changedFilesSinceLastReview: [], // no files changed
    });

    expect(result.suppressionFingerprints.size).toBe(2);
    expect(result.suppressionFingerprints.has("src/utils.ts:fp-11110000")).toBe(true);
    expect(result.suppressionFingerprints.has("src/helpers.ts:fp-22220000")).toBe(true);
  });
});

describe("shouldSuppressFinding", () => {
  test("returns true for matching fingerprint, false for non-matching", () => {
    const suppressionFingerprints = new Set([
      "src/utils.ts:fp-11110000",
      "src/helpers.ts:fp-22220000",
    ]);

    // Should suppress -- exact match
    expect(
      shouldSuppressFinding({
        filePath: "src/utils.ts",
        titleFingerprint: "fp-11110000",
        suppressionFingerprints,
      }),
    ).toBe(true);

    // Should suppress -- different file, also in set
    expect(
      shouldSuppressFinding({
        filePath: "src/helpers.ts",
        titleFingerprint: "fp-22220000",
        suppressionFingerprints,
      }),
    ).toBe(true);

    // Should NOT suppress -- same file, different fingerprint
    expect(
      shouldSuppressFinding({
        filePath: "src/utils.ts",
        titleFingerprint: "fp-99990000",
        suppressionFingerprints,
      }),
    ).toBe(false);

    // Should NOT suppress -- different file entirely
    expect(
      shouldSuppressFinding({
        filePath: "src/other.ts",
        titleFingerprint: "fp-11110000",
        suppressionFingerprints,
      }),
    ).toBe(false);

    // Should NOT suppress -- empty set
    expect(
      shouldSuppressFinding({
        filePath: "src/utils.ts",
        titleFingerprint: "fp-11110000",
        suppressionFingerprints: new Set(),
      }),
    ).toBe(false);
  });
});
