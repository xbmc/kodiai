import { describe, expect, test } from "bun:test";
import { recordReviewPostExecutionKnowledge } from "./review-post-execution-knowledge.ts";

describe("recordReviewPostExecutionKnowledge", () => {
  test("builds the review record, persists knowledge, and forwards the review id to side effects", async () => {
    const persistCalls: unknown[] = [];
    const sideEffectCalls: unknown[] = [];
    const processedFindings = [{
      filePath: "src/app.ts",
      severity: "major",
      category: "correctness",
      confidence: 0.9,
      title: "Validate cached value",
      suppressed: false,
    }];
    const suppressionMatchCounts = new Map([["ignore-generated", 2]]);

    const result = await recordReviewPostExecutionKnowledge({
      knowledgeStore: { kind: "knowledge" } as any,
      logger: { debug: () => undefined, warn: () => undefined } as any,
      repo: "xbmc/kodiai",
      owner: "xbmc",
      pr: {
        number: 42,
        title: "Fix cache reuse",
        user: { login: "author" },
        head: { sha: "head-sha" },
        base: { sha: "base-sha" },
      },
      reviewOutputKey: "review-output-key",
      deliveryId: "delivery-1",
      filesAnalyzed: 3,
      linesChanged: 44,
      findingCounts: { critical: 0, major: 1, medium: 0, minor: 0 },
      processedFindings: processedFindings as any,
      suppressionMatchCounts,
      visibleFindingCount: 1,
      lowConfidenceFindingCount: 0,
      suppressionsApplied: 2,
      config: {
        review: {
          mode: "enhanced",
          severity: { minLevel: "medium" },
          focusAreas: ["correctness"],
          maxComments: 5,
          suppressions: [{ pattern: "generated" }],
          minConfidence: 0.7,
          profile: "balanced",
        },
        knowledge: {
          shareGlobal: true,
          retrieval: {
            hunkEmbedding: {
              enabled: true,
              maxHunksPerPr: 20,
              minChangedLines: 3,
              excludePatterns: ["dist/**"],
            },
          },
        },
        model: "claude-test",
      } as any,
      reviewPlanConfigSnapshot: { plan: "snapshot" },
      reducerResult: {
        status: "ready",
        counts: { published: 1 },
        reason: "ok",
      } as any,
      reviewCandidateFindingConfigSnapshot: { finding: "config" },
      reviewCandidatePublicationRuntime: {
        safeConfigSnapshot: { publication: "config" },
      } as any,
      reviewCandidatePublicationFlow: { flow: "published" },
      result: {
        durationMs: 1234,
        conclusion: "success",
      } as any,
      contributorProfileStore: { kind: "profiles" } as any,
      learningMemoryStore: { kind: "memory" } as any,
      codeSnippetStore: { kind: "snippets" } as any,
      embeddingProvider: { kind: "embeddings" } as any,
      reviewFiles: ["src/app.ts"],
      changedFiles: ["src/app.ts", "src/helper.ts"],
      diffContent: "diff --git a/src/app.ts b/src/app.ts",
      baseLog: { deliveryId: "delivery-1" },
      persistKnowledge: async (params) => {
        persistCalls.push(params);
        return 987;
      },
      recordSideEffects: async (params) => {
        sideEffectCalls.push(params);
      },
    });

    expect(result).toEqual({ ok: true, value: { reviewId: 987 } });
    expect(persistCalls).toEqual([
      expect.objectContaining({
        repo: "xbmc/kodiai",
        prNumber: 42,
        reviewOutputKey: "review-output-key",
        record: expect.objectContaining({
          repo: "xbmc/kodiai",
          prNumber: 42,
          headSha: "head-sha",
          deliveryId: "delivery-1",
          filesAnalyzed: 3,
          linesChanged: 44,
          findingCounts: { critical: 0, major: 1, medium: 0, minor: 0 },
          findingsTotal: 1,
          suppressionsApplied: 2,
          reviewConfig: {
            mode: "enhanced",
            severityMinLevel: "medium",
            focusAreas: ["correctness"],
            maxComments: 5,
            suppressionCount: 1,
            minConfidence: 0.7,
            profile: "balanced",
          },
          shareGlobal: true,
          reviewPlan: { plan: "snapshot" },
          reviewReducer: { status: "ready", counts: { published: 1 }, reason: "ok" },
          reviewCandidateFinding: { finding: "config" },
          reviewCandidatePublication: { publication: "config" },
          reviewCandidatePublicationFlow: { flow: "published" },
          durationMs: 1234,
          model: "claude-test",
          conclusion: "success",
        }),
        processedFindings,
        suppressionMatchCounts,
        visibleFindingCount: 1,
        lowConfidenceFindingCount: 0,
        suppressionsApplied: 2,
        shareGlobal: true,
      }),
    ]);
    expect(sideEffectCalls).toEqual([
      expect.objectContaining({
        repo: "xbmc/kodiai",
        owner: "xbmc",
        prNumber: 42,
        prAuthor: "author",
        prTitle: "Fix cache reuse",
        baseSha: "base-sha",
        headSha: "head-sha",
        filesChanged: ["src/app.ts"],
        changedFilesForLanguageContext: ["src/app.ts", "src/helper.ts"],
        findings: processedFindings,
        reviewId: 987,
        diffContent: "diff --git a/src/app.ts b/src/app.ts",
        hunkEmbeddingConfig: {
          enabled: true,
          maxHunksPerPr: 20,
          minChangedLines: 3,
          excludePatterns: ["dist/**"],
        },
        logContext: { deliveryId: "delivery-1" },
      }),
    ]);
  });

  test("returns a Result error when persistence fails before scheduling side effects", async () => {
    const sideEffectCalls: unknown[] = [];
    const err = new Error("database offline");

    const result = await recordReviewPostExecutionKnowledge({
      ...baseParams(),
      persistKnowledge: async () => {
        throw err;
      },
      recordSideEffects: async (params) => {
        sideEffectCalls.push(params);
      },
    });

    expect(result).toEqual({ ok: false, err });
    expect(sideEffectCalls).toEqual([]);
  });

  test("returns a Result error when post-execution side effects fail", async () => {
    const err = new Error("side effect failed");

    const result = await recordReviewPostExecutionKnowledge({
      ...baseParams(),
      persistKnowledge: async () => 654,
      recordSideEffects: async () => {
        throw err;
      },
    });

    expect(result).toEqual({ ok: false, err });
  });
});

function baseParams(): Parameters<typeof recordReviewPostExecutionKnowledge>[0] {
  return {
    knowledgeStore: { kind: "knowledge" } as any,
    logger: { debug: () => undefined, warn: () => undefined } as any,
    repo: "xbmc/kodiai",
    owner: "xbmc",
    pr: {
      number: 42,
      title: "Fix cache reuse",
      user: { login: "author" },
      head: { sha: "head-sha" },
      base: { sha: "base-sha" },
    },
    reviewOutputKey: "review-output-key",
    deliveryId: "delivery-1",
    filesAnalyzed: 3,
    linesChanged: 44,
    findingCounts: { critical: 0, major: 1, medium: 0, minor: 0 },
    processedFindings: [],
    suppressionMatchCounts: new Map(),
    visibleFindingCount: 0,
    lowConfidenceFindingCount: 0,
    suppressionsApplied: 0,
    config: {
      review: {
        mode: "enhanced",
        severity: { minLevel: "medium" },
        focusAreas: ["correctness"],
        maxComments: 5,
        suppressions: [],
        minConfidence: 0.7,
        profile: "balanced",
      },
      knowledge: {
        shareGlobal: true,
        retrieval: {
          hunkEmbedding: {
            enabled: true,
            maxHunksPerPr: 20,
            minChangedLines: 3,
            excludePatterns: ["dist/**"],
          },
        },
      },
      model: "claude-test",
    } as any,
    reviewPlanConfigSnapshot: { plan: "snapshot" },
    reducerResult: {
      status: "ready",
      counts: { published: 1 },
      reason: "ok",
    } as any,
    reviewCandidateFindingConfigSnapshot: { finding: "config" },
    reviewCandidatePublicationRuntime: {
      safeConfigSnapshot: { publication: "config" },
    } as any,
    reviewCandidatePublicationFlow: { flow: "published" },
    result: {
      durationMs: 1234,
      conclusion: "success",
    } as any,
    reviewFiles: ["src/app.ts"],
    changedFiles: ["src/app.ts", "src/helper.ts"],
    diffContent: "diff --git a/src/app.ts b/src/app.ts",
    baseLog: { deliveryId: "delivery-1" },
  };
}
