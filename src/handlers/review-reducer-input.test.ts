import { describe, expect, test } from "bun:test";
import { buildReviewReducerInput } from "./review-reducer-input.ts";

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    extractedFindings: [],
    reviewCandidateFindingResult: { findings: [], status: "ready" } as never,
    workspaceDir: ".",
    filesByCategory: {},
    filesByLanguage: {},
    languageRules: undefined,
    reviewSuppressions: [],
    minConfidence: 50,
    feedbackSuppression: { suppressedFingerprints: new Set(), suppressedPatternCount: 0, patterns: [] },
    priorFindingContext: null,
    diffContent: "",
    prBody: null,
    commitMessages: [],
    tieredFiles: { isLargePR: false, abbreviated: [] },
    graphBlastRadius: null,
    graphValidationEnabled: false,
    riskScores: [],
    logger: { info: () => undefined, warn: () => undefined } as never,
    baseLog: {},
    repo: "owner/repo",
    clusterModelStore: null,
    embeddingProvider: null,
    guardrailAuditStore: undefined,
    graphValidationLLM: null,
    repoDoctrine: null,
    ...overrides,
  } as unknown as Parameters<typeof buildReviewReducerInput>[0];
}

describe("buildReviewReducerInput", () => {
  test("normalizes a producer's `body` into `reasoning` for the grounding gates", () => {
    // Comment-slop detections and candidate drafts carry their prose in `body`,
    // while comments extracted from GitHub carry `reasoning`. Semantic grounding
    // fact-checks `reasoning`, so an un-normalized `body` would leave the gate
    // judging a bare title and unable to confirm anything.
    const input = buildReviewReducerInput(baseParams({
      extractedFindings: [{
        commentId: 1,
        filePath: "src/a.ts",
        title: "Bare title",
        severity: "critical",
        category: "correctness",
        body: "The lock is released before the read completes.",
      }],
    }));

    expect(input.findings[0]?.reasoning).toBe("The lock is released before the read completes.");
  });

  test("leaves an existing `reasoning` untouched", () => {
    const input = buildReviewReducerInput(baseParams({
      extractedFindings: [{
        commentId: 1,
        filePath: "src/a.ts",
        title: "Bare title",
        severity: "critical",
        category: "correctness",
        reasoning: "Original reasoning.",
        body: "Publication body.",
      }],
    }));

    expect(input.findings[0]?.reasoning).toBe("Original reasoning.");
  });

  test("does not invent a reasoning field when the finding has no prose at all", () => {
    const input = buildReviewReducerInput(baseParams({
      extractedFindings: [{
        commentId: 1,
        filePath: "src/a.ts",
        title: "Bare title",
        severity: "critical",
        category: "correctness",
      }],
    }));

    expect(input.findings[0]?.reasoning).toBeUndefined();
  });
});
