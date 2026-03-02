import { describe, expect, test } from "bun:test";
import {
  extractClaims,
  classifyClaimHeuristic,
  computeSummaryLabel,
  classifyClaims,
  type ClaimClassification,
  type ClaimLabel,
  type DiffContext,
  type ClassifierInput,
  type FindingForClassification,
} from "./claim-classifier.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDiffContext(overrides: Partial<DiffContext> = {}): DiffContext {
  return {
    rawPatch: "",
    addedLines: [],
    removedLines: [],
    contextLines: [],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<FindingForClassification> = {}): FindingForClassification {
  return {
    commentId: 1,
    filePath: "src/app.ts",
    title: "Some finding title",
    severity: "medium",
    category: "correctness",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractClaims
// ---------------------------------------------------------------------------

describe("extractClaims", () => {
  test("splits multi-sentence finding into individual claims", () => {
    const text =
      "This PR updates lodash from 4.17.20 to 4.17.21. The new version fixes CVE-2021-23337 which allowed prototype pollution.";
    const claims = extractClaims(text);
    expect(claims.length).toBeGreaterThanOrEqual(2);
  });

  test("returns single claim for single-sentence finding", () => {
    const claims = extractClaims("Missing null check on user input.");
    expect(claims).toHaveLength(1);
  });

  test("handles empty string", () => {
    const claims = extractClaims("");
    expect(claims).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// classifyClaimHeuristic — version numbers
// ---------------------------------------------------------------------------

describe("classifyClaimHeuristic — version numbers", () => {
  test("classifies version number NOT in diff as external-knowledge", () => {
    const result = classifyClaimHeuristic(
      "Version 3.2.1 introduced a breaking change in the API",
      makeDiffContext({ addedLines: ["import lodash from 'lodash'"], removedLines: [] }),
      null,
      [],
    );
    expect(result.label).toBe("external-knowledge");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.evidence).toBeDefined();
  });

  test("classifies version number visible in diff as diff-grounded", () => {
    const result = classifyClaimHeuristic(
      "This updates lodash from 4.17.20 to 4.17.21",
      makeDiffContext({
        addedLines: ['"lodash": "4.17.21"'],
        removedLines: ['"lodash": "4.17.20"'],
      }),
      null,
      [],
    );
    expect(result.label).toBe("diff-grounded");
  });
});

// ---------------------------------------------------------------------------
// classifyClaimHeuristic — diff-grounded
// ---------------------------------------------------------------------------

describe("classifyClaimHeuristic — diff-grounded", () => {
  test("classifies claim about visible code change as diff-grounded", () => {
    const result = classifyClaimHeuristic(
      "This removes the null check on line 45",
      makeDiffContext({
        removedLines: ["  if (value === null) return;"],
        contextLines: ["function processValue(value) {"],
      }),
      null,
      [],
    );
    expect(result.label).toBe("diff-grounded");
  });

  test("classifies claim matching PR description as diff-grounded", () => {
    const result = classifyClaimHeuristic(
      "This adds retry logic to the HTTP client",
      makeDiffContext(),
      "Added retry logic to the HTTP client for improved reliability",
      [],
    );
    expect(result.label).toBe("diff-grounded");
  });
});

// ---------------------------------------------------------------------------
// classifyClaimHeuristic — inferential
// ---------------------------------------------------------------------------

describe("classifyClaimHeuristic — inferential", () => {
  test("classifies logical deduction from diff as inferential", () => {
    const result = classifyClaimHeuristic(
      "Removing this null check could cause a NullPointerException",
      makeDiffContext({
        removedLines: ["  if (value === null) return;"],
      }),
      null,
      [],
    );
    expect(result.label).toBe("inferential");
  });
});

// ---------------------------------------------------------------------------
// classifyClaimHeuristic — external-knowledge signals
// ---------------------------------------------------------------------------

describe("classifyClaimHeuristic — external-knowledge signals", () => {
  test("classifies release date reference as external-knowledge", () => {
    const result = classifyClaimHeuristic(
      "This feature was introduced in the March 2024 release",
      makeDiffContext(),
      null,
      [],
    );
    expect(result.label).toBe("external-knowledge");
  });

  test("classifies API behavior assertion as external-knowledge", () => {
    const result = classifyClaimHeuristic(
      "This API is known to throw on null input",
      makeDiffContext(),
      null,
      [],
    );
    expect(result.label).toBe("external-knowledge");
  });

  test("classifies CVE reference as external-knowledge", () => {
    const result = classifyClaimHeuristic(
      "This vulnerability is tracked as CVE-2024-1234",
      makeDiffContext(),
      null,
      [],
    );
    expect(result.label).toBe("external-knowledge");
  });

  test("classifies performance claim without code evidence as external-knowledge", () => {
    const result = classifyClaimHeuristic(
      "This algorithm has O(n^2) complexity and will degrade with large inputs",
      makeDiffContext({ addedLines: ["return data.filter(x => x > 0)"] }),
      null,
      [],
    );
    expect(result.label).toBe("external-knowledge");
  });

  test("classifies compatibility claim as external-knowledge", () => {
    const result = classifyClaimHeuristic(
      "This is only compatible with Node.js version 18 and above",
      makeDiffContext(),
      null,
      [],
    );
    expect(result.label).toBe("external-knowledge");
  });
});

// ---------------------------------------------------------------------------
// computeSummaryLabel
// ---------------------------------------------------------------------------

describe("computeSummaryLabel", () => {
  test("returns primarily-diff-grounded when all claims are diff-grounded", () => {
    const claims: ClaimClassification[] = [
      { text: "a", label: "diff-grounded", confidence: 0.9 },
      { text: "b", label: "diff-grounded", confidence: 0.8 },
    ];
    expect(computeSummaryLabel(claims)).toBe("primarily-diff-grounded");
  });

  test("returns primarily-diff-grounded when all claims are inferential", () => {
    const claims: ClaimClassification[] = [
      { text: "a", label: "inferential", confidence: 0.9 },
    ];
    expect(computeSummaryLabel(claims)).toBe("primarily-diff-grounded");
  });

  test("returns primarily-external when all claims are external-knowledge", () => {
    const claims: ClaimClassification[] = [
      { text: "a", label: "external-knowledge", confidence: 0.9 },
      { text: "b", label: "external-knowledge", confidence: 0.8 },
    ];
    expect(computeSummaryLabel(claims)).toBe("primarily-external");
  });

  test("returns mixed for combination of diff-grounded and external-knowledge", () => {
    const claims: ClaimClassification[] = [
      { text: "a", label: "diff-grounded", confidence: 0.9 },
      { text: "b", label: "diff-grounded", confidence: 0.8 },
      { text: "c", label: "external-knowledge", confidence: 0.7 },
    ];
    expect(computeSummaryLabel(claims)).toBe("mixed");
  });

  test("returns primarily-diff-grounded for empty claims array (fail-open)", () => {
    expect(computeSummaryLabel([])).toBe("primarily-diff-grounded");
  });
});

// ---------------------------------------------------------------------------
// classifyClaims — integration
// ---------------------------------------------------------------------------

describe("classifyClaims", () => {
  test("returns findings annotated with claim classifications", () => {
    const input: ClassifierInput = {
      findings: [
        makeFinding({
          title: "This removes the null check which could cause errors",
        }),
      ],
      fileDiffs: new Map([
        ["src/app.ts", makeDiffContext({ removedLines: ["  if (x === null) return;"] })],
      ]),
      prDescription: null,
      commitMessages: [],
    };

    const result = classifyClaims(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.claimClassification).toBeDefined();
    expect(result[0]!.claimClassification.summaryLabel).toBeDefined();
    expect(result[0]!.claimClassification.claims.length).toBeGreaterThanOrEqual(1);
  });

  test("fail-open: returns findings with default classification on error", () => {
    // Pass invalid input that would cause internal error
    const input: ClassifierInput = {
      findings: [makeFinding({ title: "Normal finding" })],
      fileDiffs: null as unknown as Map<string, DiffContext>,
      prDescription: null,
      commitMessages: [],
    };

    const result = classifyClaims(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.claimClassification.summaryLabel).toBe("primarily-diff-grounded");
  });

  test("each claim has confidence between 0 and 1", () => {
    const input: ClassifierInput = {
      findings: [
        makeFinding({
          title: "Version 3.2.1 introduced a breaking change",
        }),
      ],
      fileDiffs: new Map(),
      prDescription: null,
      commitMessages: [],
    };

    const result = classifyClaims(input);
    for (const claim of result[0]!.claimClassification.claims) {
      expect(claim.confidence).toBeGreaterThanOrEqual(0);
      expect(claim.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("each claim has evidence string", () => {
    const input: ClassifierInput = {
      findings: [
        makeFinding({
          title: "CVE-2024-5678 affects this dependency",
        }),
      ],
      fileDiffs: new Map(),
      prDescription: null,
      commitMessages: [],
    };

    const result = classifyClaims(input);
    for (const claim of result[0]!.claimClassification.claims) {
      expect(typeof claim.evidence).toBe("string");
    }
  });
});
