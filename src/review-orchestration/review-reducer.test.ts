import { describe, expect, test } from "bun:test";
import {
  buildReviewReducerCounts,
  createDegradedReviewReducerResult,
  reduceReviewFindings,
  toReviewReducerDetailsSummary,
  type ProcessedReviewFinding,
  type ReviewReducerAuditEvent,
  type ReviewReducerResult,
} from "./review-reducer.ts";

const baseFinding = (overrides: Partial<ProcessedReviewFinding> = {}): ProcessedReviewFinding => ({
  commentId: 1,
  filePath: "src/example.ts",
  title: "Use the validated input before saving",
  severity: "major",
  category: "correctness",
  startLine: 10,
  endLine: 12,
  suppressed: false,
  confidence: 90,
  ...overrides,
});

describe("buildReviewReducerCounts", () => {
  test("counts ready reducer outcomes with bounded vocabulary", () => {
    const findings: ProcessedReviewFinding[] = [
      baseFinding({ commentId: 1, graphValidated: true, graphValidationVerdict: "confirmed" }),
      baseFinding({ commentId: 2, suppressed: true, filterAction: "suppressed" }),
      baseFinding({ commentId: 3, filterAction: "rewritten", originalTitle: "Old unverified title" }),
      baseFinding({ commentId: 4, confidence: 44 }),
      baseFinding({ commentId: 5, deprioritized: true }),
      baseFinding({ commentId: 6, severityDemoted: true, preDemotionSeverity: "critical", demotionReason: "external-claim" }),
      baseFinding({ commentId: 7, graphValidated: true, graphValidationVerdict: "uncertain" }),
    ];
    const audit: ReviewReducerAuditEvent[] = [
      { action: "suppressed", source: "output-filter" },
      { action: "rewritten", source: "guardrail" },
    ];

    expect(buildReviewReducerCounts(findings, audit, { minConfidence: 50 })).toEqual({
      input: 7,
      kept: 4,
      suppressed: 1,
      rewritten: 1,
      deprioritized: 1,
      lowConfidence: 1,
      auditEvents: 2,
      severityDemoted: 1,
      graphValidated: 2,
      graphUncertain: 1,
    });
  });

  test("handles malformed optional metadata and empty boundaries without throwing", () => {
    expect(buildReviewReducerCounts([], [], { minConfidence: 50 })).toEqual({
      input: 0,
      kept: 0,
      suppressed: 0,
      rewritten: 0,
      deprioritized: 0,
      lowConfidence: 0,
      auditEvents: 0,
      severityDemoted: 0,
      graphValidated: 0,
      graphUncertain: 0,
    });

    expect(() => buildReviewReducerCounts([
      baseFinding({ commentId: 2, confidence: undefined, claimClassification: undefined }),
    ], undefined, { minConfidence: 50 })).not.toThrow();
  });

  test("counts overlapping filtered states with reducer-visible predicates", () => {
    expect(buildReviewReducerCounts([
      baseFinding({ commentId: 1, suppressed: true, filterAction: "suppressed", confidence: 10 }),
      baseFinding({ commentId: 2, deprioritized: true, confidence: 10 }),
      baseFinding({ commentId: 3, confidence: 10 }),
      baseFinding({ commentId: 4, confidence: 90 }),
    ], [], { minConfidence: 50 })).toMatchObject({
      input: 4,
      kept: 1,
      suppressed: 1,
      deprioritized: 1,
      lowConfidence: 1,
    });
  });
});

describe("toReviewReducerDetailsSummary", () => {
  test("projects a compact public-safe ready summary", () => {
    const result: Pick<ReviewReducerResult, "status" | "counts"> = {
      status: "ready",
      counts: {
        input: 4,
        kept: 2,
        suppressed: 1,
        rewritten: 1,
        deprioritized: 0,
        lowConfidence: 1,
        auditEvents: 3,
        severityDemoted: 1,
        graphValidated: 2,
        graphUncertain: 1,
      },
    };

    const summary = toReviewReducerDetailsSummary(result);

    expect(summary.label).toBe("Review reducer");
    expect(summary.status).toBe("ready");
    expect(summary.text.length).toBeLessThanOrEqual(240);
    expect(summary.text).toContain("Review reducer: ready");
    expect(summary.text).toContain("input=4");
    expect(summary.text).toContain("kept=2");
    expect(summary.text).toContain("suppressed=1");
    expect(summary.text).toContain("rewritten=1");
    expect(summary.text).toContain("graphValidated=2");
    expect(summary.text).toContain("graphUncertain=1");
  });
});

describe("reduceReviewFindings", () => {
  test("applies suppression, rewrite, prioritization, and min-confidence gates in handler order", async () => {
    const findings: ProcessedReviewFinding[] = [
      baseFinding({ commentId: 1, title: "Suppress this legacy issue", severity: "major", category: "correctness" }),
      baseFinding({
        commentId: 2,
        title: "The code mutates persisted state. Some external API always fails in v1.2.3.",
        severity: "major",
        category: "correctness",
        claimClassification: {
          summaryLabel: "mixed",
          claims: [
            { text: "The code mutates persisted state and skips required validation before writing to disk", label: "diff-grounded", confidence: 0.95 },
            { text: "Some external API always fails in v1.2.3", label: "external-knowledge", evidence: "version-specific claim", confidence: 0.9 },
          ],
        },
      }),
      baseFinding({ commentId: 3, title: "Low confidence style nit", severity: "minor", category: "style" }),
      baseFinding({ commentId: 4, title: "High risk security issue", severity: "critical", category: "security", filePath: "src/risky.ts" }),
      baseFinding({ commentId: 5, title: "Medium priority correctness issue", severity: "medium", category: "correctness", filePath: "src/boring.ts" }),
    ];

    const result = await reduceReviewFindings({
      findings,
      workspaceDir: ".",
      filesByCategory: {},
      filesByLanguage: {},
      languageRules: undefined,
      reviewSuppressions: ["legacy issue"],
      minConfidence: 50,
      prioritizationWeights: { severity: 1, fileRisk: 0, category: 0, recurrence: 0 },
      feedbackSuppression: { suppressedFingerprints: new Set(), suppressedPatternCount: 0, patterns: [] },
      priorFindingContext: null,
      diffContent: "",
      prBody: null,
      commitMessages: [],
      tieredFiles: { isLargePR: false, abbreviated: [] },
      graphBlastRadius: null,
      graphValidationEnabled: false,
      riskScores: [{ filePath: "src/risky.ts", score: 99 }, { filePath: "src/boring.ts", score: 0 }],
      resolvedMaxComments: 2,
      logger: testLogger(),
      baseLog: { repo: "owner/repo", prNumber: 1 },
      repo: "owner/repo",
      clusterModelStore: null,
      embeddingProvider: null,
      guardrailAuditStore: undefined,
      graphValidationLLM: null,
    });

    expect(result.status).toBe("ready");
    expect(result.findings).toHaveLength(5);
    expect(result.visibleFindings.map((f) => f.commentId).sort()).toEqual([2, 4]);
    expect(result.lowConfidenceFindings.map((f) => f.commentId)).toEqual([3]);
    expect(result.filteredInlineFindings.map((f) => f.commentId).sort()).toEqual([1, 3, 5]);
    expect(result.suppressionMatchCounts).toEqual(new Map([["legacy issue", 1]]));
    expect(result.filterRecords).toHaveLength(1);
    expect(result.filterRecords[0]!.action).toBe("rewritten");
    expect(result.findings.find((f) => f.commentId === 2)?.filterAction).toBe("rewritten");
    expect(result.findings.find((f) => f.commentId === 5)?.deprioritized).toBe(true);
    expect(result.prioritizationStats).toMatchObject({ maxComments: 2, selectedFindings: 2, omittedFindings: 1 });
    expect(result.counts).toMatchObject({ input: 5, kept: 2, suppressed: 1, rewritten: 1, lowConfidence: 1, deprioritized: 1 });
    expect(result.detailsSummary.text).toContain("Review reducer: ready");
  });

  test("keeps graph validation metadata-only and fails open when graph validation throws", async () => {
    const findings = [
      baseFinding({ commentId: 1, filePath: "src/direct.ts" }),
      baseFinding({ commentId: 2, filePath: "src/indirect.ts" }),
    ];
    const graphBlastRadius = {
      changedFiles: ["src/direct.ts"],
      seedSymbols: [],
      impactedFiles: [{ path: "src/indirect.ts", score: 1, confidence: 1, maxConfidence: 1, reasons: [], relatedChangedPaths: [], languages: [] }],
      probableDependents: [],
      likelyTests: [],
      graphStats: { files: 2, nodes: 0, edges: 0, changedFilesFound: 1 },
    };

    const validated = await reduceReviewFindings({
      ...minimalReducerInput(findings),
      graphBlastRadius,
      graphValidationEnabled: true,
      graphValidationLLM: { generate: async () => "1: UNCERTAIN" },
    });

    expect(validated.visibleFindings).toHaveLength(2);
    expect(validated.findings.find((f) => f.commentId === 2)).toMatchObject({
      graphValidated: true,
      graphValidationVerdict: "uncertain",
      suppressed: false,
    });
    expect(validated.counts.graphValidated).toBe(1);
    expect(validated.counts.graphUncertain).toBe(1);

    const failedOpen = await reduceReviewFindings({
      ...minimalReducerInput(findings),
      graphBlastRadius,
      graphValidationEnabled: true,
      graphValidationLLM: { generate: async () => { throw new Error("llm unavailable"); } },
    });

    expect(failedOpen.visibleFindings).toHaveLength(2);
    expect(failedOpen.findings.every((f) => f.graphValidationVerdict === undefined)).toBe(true);
    expect(failedOpen.audit.some((event) => event.source === "graph-validation" && event.reason === "failed-open")).toBe(true);
  });

  test("records guardrail suppress/rewrite audit counts and fails open on guardrail throw", async () => {
    const findings = [
      baseFinding({ commentId: 1, title: "Remove unsafe claim" }),
      baseFinding({ commentId: 2, title: "Rewrite unsafe claim" }),
      baseFinding({ commentId: 3, title: "Keep grounded claim" }),
    ];

    const guarded = await reduceReviewFindings({
      ...minimalReducerInput(findings),
      runGuardrailPipeline: async (opts: unknown) => {
        const { output } = opts as { output: { findings: ProcessedReviewFinding[] } };
        return {
        output: { findings: [
          { ...output.findings[1]!, title: "Rewritten grounded claim" },
          output.findings[2]!,
        ] },
        claimsTotal: 3,
        claimsRemoved: 1,
        auditRecords: [],
        suppressed: false,
        classifierError: false,
      };
      },
    });

    expect(guarded.findings.find((f) => f.commentId === 1)).toMatchObject({ suppressed: true, filterAction: "guardrail-suppressed" });
    expect(guarded.findings.find((f) => f.commentId === 2)).toMatchObject({ title: "Rewritten grounded claim", filterAction: "guardrail-rewritten" });
    expect(guarded.counts).toMatchObject({ suppressed: 1, rewritten: 1 });
    expect(guarded.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "guardrail-suppressed", count: 1 }),
      expect.objectContaining({ action: "guardrail-rewritten", count: 1 }),
    ]));

    const thrown = await reduceReviewFindings({
      ...minimalReducerInput(findings),
      runGuardrailPipeline: async () => { throw new Error("guardrail down"); },
    });

    expect(thrown.visibleFindings).toHaveLength(3);
    expect(thrown.filteredInlineFindings).toEqual([]);
    expect(thrown.audit.some((event) => event.source === "guardrail" && event.reason === "failed-open")).toBe(true);
  });

  test("does not deprioritize findings exactly at the max comment boundary", async () => {
    const result = await reduceReviewFindings({
      ...minimalReducerInput([
        baseFinding({ commentId: 1 }),
        baseFinding({ commentId: 2 }),
      ]),
      resolvedMaxComments: 2,
    });

    expect(result.prioritizationStats).toBeUndefined();
    expect(result.filteredInlineFindings).toEqual([]);
    expect(result.visibleFindings).toHaveLength(2);
  });
});

function minimalReducerInput(findings: ProcessedReviewFinding[]) {
  return {
    findings,
    workspaceDir: ".",
    filesByCategory: {},
    filesByLanguage: {},
    languageRules: undefined,
    reviewSuppressions: [],
    minConfidence: 50,
    prioritizationWeights: { severity: 1, fileRisk: 0, category: 0, recurrence: 0 },
    feedbackSuppression: { suppressedFingerprints: new Set<string>(), suppressedPatternCount: 0, patterns: [] },
    priorFindingContext: null,
    diffContent: "",
    prBody: null,
    commitMessages: [],
    tieredFiles: { isLargePR: false, abbreviated: [] },
    graphBlastRadius: null,
    graphValidationEnabled: false,
    riskScores: [],
    resolvedMaxComments: 50,
    logger: testLogger(),
    baseLog: { repo: "owner/repo", prNumber: 1 },
    repo: "owner/repo",
    clusterModelStore: null,
    embeddingProvider: null,
    guardrailAuditStore: undefined,
    graphValidationLLM: null,
  };
}

function testLogger() {
  return {
    info: () => {},
    warn: () => {},
    debug: () => {},
  };
}

describe("createDegradedReviewReducerResult", () => {
  test("fails open by preserving visible findings and never scheduling deletions", () => {
    const findings = [
      baseFinding({ commentId: 1, suppressed: true, confidence: 10, title: "raw diff --git should stay on finding only" }),
      baseFinding({ commentId: 2, confidence: undefined }),
    ];

    const result = createDegradedReviewReducerResult({
      findings,
      reason: "Reducer blew up with diff --git and PROMPT_SECRET and TOKEN=abc123 and sk-1234567890".repeat(6),
    });

    expect(result.status).toBe("degraded");
    expect(result.visibleFindings).toHaveLength(2);
    expect(result.visibleFindings[0]).toEqual(findings[0]);
    expect(result.visibleFindings[1]!.confidence).toBe(100);
    expect(result.filteredInlineFindings).toEqual([]);
    expect(result.counts).toEqual({
      input: 2,
      kept: 2,
      suppressed: 0,
      rewritten: 0,
      deprioritized: 0,
      lowConfidence: 0,
      auditEvents: 1,
      severityDemoted: 0,
      graphValidated: 0,
      graphUncertain: 0,
    });
    expect(result.detailsSummary.label).toBe("Review reducer");
    expect(result.detailsSummary.status).toBe("degraded");
    expect(result.detailsSummary.text).toContain("Review reducer: degraded");
    expect(result.detailsSummary.text.length).toBeLessThanOrEqual(240);
    expect(result.detailsSummary.text).not.toContain("diff --git");
    expect(result.detailsSummary.text).not.toContain("PROMPT_SECRET");
    expect(result.detailsSummary.text).not.toContain("TOKEN");
    expect(result.detailsSummary.text).not.toContain("sk-1234567890");
    expect(result.detailsSummary.text).not.toContain("{");
  });
});
