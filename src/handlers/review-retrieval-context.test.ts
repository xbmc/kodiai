import { describe, expect, test } from "bun:test";
import {
  buildReviewRetrievalContext,
  resolveReviewRetrievalPromptContext,
} from "./review-retrieval-context.ts";

function makeLogger() {
  const warnings: Array<{ obj: unknown; msg: string }> = [];
  return {
    warnings,
    logger: {
      warn: (obj: unknown, msg: string) => warnings.push({ obj, msg }),
    },
  };
}

function makeRetrieveResult(overrides: Record<string, unknown> = {}) {
  return {
    findings: [
      {
        memoryId: 7,
        distance: 0.41,
        adjustedDistance: 0.31,
        languageMatch: true,
        sourceRepo: "owner/repo",
        matchedVariants: ["intent"],
        score: 1,
        record: {
          id: 7,
          repo: "owner/repo",
          prNumber: 10,
          filePath: "src/app.ts",
          findingText: "Validate the cached value before reuse.",
          severity: "major",
          category: "correctness",
          outcome: "fixed",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ],
    snippetAnchors: [
      {
        path: "src/app.ts",
        line: 42,
        snippet: "const cached = readCache();",
      },
    ],
    reviewPrecedents: [
      {
        chunkText: "Prior review precedent",
        distance: 0.2,
        repo: "owner/repo",
        prNumber: 9,
        prTitle: "Previous PR",
        commentGithubId: 123,
        chunkIndex: 0,
        filePath: "src/app.ts",
        authorLogin: "reviewer",
        authorAssociation: "MEMBER",
        githubCreatedAt: "2026-01-01T00:00:00.000Z",
        startLine: 10,
        endLine: 11,
        source: "review_comment",
      },
    ],
    wikiKnowledge: [
      {
        chunkText: "Wiki retrieval chunk",
        rawText: "Wiki retrieval chunk",
        distance: 0.3,
        pageId: 1,
        pageTitle: "Cache Safety",
        namespace: "docs",
        pageUrl: "https://example.test/wiki/cache",
        sectionHeading: null,
        sectionAnchor: null,
        lastModified: null,
        source: "wiki",
        languageTags: ["typescript"],
      },
    ],
    unifiedResults: [
      {
        id: "wiki:1",
        text: "Unified retrieval chunk",
        source: "wiki",
        sourceLabel: "[wiki: Cache Safety]",
        sourceUrl: "https://example.test/wiki/cache",
        vectorDistance: 0.3,
        rrfScore: 0.5,
        createdAt: null,
        metadata: {},
      },
    ],
    contextWindow: "[wiki: Cache Safety]\nUnified retrieval chunk",
    provenance: {
      queryCount: 2,
      candidateCount: 4,
      sharedPoolUsed: false,
      thresholdMethod: "configured",
      thresholdValue: 0.7,
      reviewCommentCount: 1,
      wikiPageCount: 1,
      snippetCount: 0,
      issueCount: 0,
      canonicalCodeCount: 0,
      unifiedResultCount: 1,
      embeddingRequests: 1,
      embeddingCacheHits: 1,
      rerankApplied: false,
      hybridSearchUsed: false,
      rrfK: 60,
      dedupThreshold: 0.9,
      triggerType: "pr_review",
    },
    ...overrides,
  };
}

describe("buildReviewRetrievalContext", () => {
  test("retrieves prompt context and records reuse plus quality telemetry", async () => {
    const retrieveCalls: unknown[] = [];
    const rateLimitEvents: unknown[] = [];
    const reviewCacheEvents: unknown[] = [];
    const qualityEvents: unknown[] = [];
    const { logger } = makeLogger();

    const result = await buildReviewRetrievalContext({
      retriever: {
        retrieve: async (opts: unknown) => {
          retrieveCalls.push(opts);
          return makeRetrieveResult();
        },
      } as any,
      repo: "owner/repo",
      owner: "owner",
      prNumber: 10,
      deliveryId: "delivery-1",
      eventName: "pull_request.opened",
      workspaceDir: "/tmp/workspace",
      prTitle: "Improve cache reuse",
      prBody: "Adds cache reuse.",
      conventionalType: "fix",
      prLanguages: ["typescript"],
      riskSignals: ["cache"],
      filePaths: ["src/app.ts"],
      authorContract: {
        state: "profile-backed",
        promptTier: "senior",
        promptPolicy: { kind: "profile-backed-senior" },
      },
      retrievalConfig: {
        topK: 5,
        maxContextChars: 1200,
      },
      telemetryEnabled: true,
      telemetryStore: {
        recordRateLimitEvent: async (entry: unknown) => {
          rateLimitEvents.push(entry);
        },
        recordReviewCacheEvent: async (entry: unknown) => {
          reviewCacheEvents.push(entry);
        },
        recordRetrievalQuality: async (entry: unknown) => {
          qualityEvents.push(entry);
        },
      } as any,
      logger: logger as any,
      baseLog: { deliveryId: "delivery-1" },
    });

    expect(retrieveCalls).toHaveLength(1);
    expect((retrieveCalls[0] as any).queries.join("\n")).toContain("senior contributor");
    expect(result.retrievalContext?.findings).toEqual([
      {
        findingText: "Validate the cached value before reuse.",
        severity: "major",
        category: "correctness",
        path: "src/app.ts",
        line: 42,
        snippet: "const cached = readCache();",
        outcome: "fixed",
        distance: 0.31,
        sourceRepo: "owner/repo",
      },
    ]);
    expect(result.reviewPrecedents).toHaveLength(1);
    expect(result.wikiKnowledge).toHaveLength(1);
    expect(result.unifiedResults).toHaveLength(1);
    expect(result.contextWindow).toContain("Unified retrieval chunk");
    expect(result.visibleBudgetState.reviewCacheObservations).toHaveLength(1);
    expect(rateLimitEvents).toHaveLength(1);
    expect(reviewCacheEvents).toHaveLength(1);
    expect(qualityEvents).toEqual([
      expect.objectContaining({
        repo: "owner/repo",
        prNumber: 10,
        eventType: "pull_request.opened",
        topK: 5,
        distanceThreshold: 0.7,
        resultCount: 1,
        avgDistance: 0.31,
        languageMatchRatio: 1,
      }),
    ]);
  });

  test("fails open when retrieval throws", async () => {
    const { logger, warnings } = makeLogger();

    const result = await buildReviewRetrievalContext({
      retriever: {
        retrieve: async () => {
          throw new Error("retrieval unavailable");
        },
      } as any,
      repo: "owner/repo",
      owner: "owner",
      prNumber: 10,
      deliveryId: "delivery-1",
      eventName: "pull_request.opened",
      workspaceDir: "/tmp/workspace",
      prTitle: "Improve cache reuse",
      prBody: undefined,
      conventionalType: null,
      prLanguages: [],
      riskSignals: [],
      filePaths: [],
      authorContract: null,
      retrievalConfig: {
        topK: 5,
        maxContextChars: 1200,
      },
      telemetryEnabled: true,
      telemetryStore: {
        recordRateLimitEvent: async () => {},
        recordReviewCacheEvent: async () => {},
        recordRetrievalQuality: async () => {},
      } as any,
      logger: logger as any,
      baseLog: { deliveryId: "delivery-1" },
    });

    expect(result.retrievalContext).toBeNull();
    expect(result.reviewPrecedents).toEqual([]);
    expect(result.wikiKnowledge).toEqual([]);
    expect(result.unifiedResults).toEqual([]);
    expect(result.contextWindow).toBeUndefined();
    expect(result.visibleBudgetState.reviewCacheObservations).toEqual([]);
    expect(warnings.map((entry) => entry.msg)).toContain(
      "Retrieval context generation failed (fail-open, proceeding without retrieval)",
    );
  });
});

describe("resolveReviewRetrievalPromptContext", () => {
  test("derives retrieval inputs from review state and exposes prompt-facing aliases", async () => {
    const buildCalls: unknown[] = [];
    const expectedResult = {
      retrievalContext: {
        maxChars: 1200,
        findings: [],
      },
      visibleBudgetState: { refresh: () => null, reviewCacheObservations: [] },
      reviewPrecedents: [{ chunkText: "precedent" }],
      wikiKnowledge: [{ chunkText: "wiki" }],
      unifiedResults: [{ id: "wiki:1" }],
      contextWindow: "[wiki]\nchunk",
    };

    const result = await resolveReviewRetrievalPromptContext({
      retriever: { retrieve: async () => makeRetrieveResult() } as any,
      apiOwner: "owner",
      apiRepo: "repo",
      pr: {
        number: 10,
        title: "Improve cache reuse",
        body: null,
      },
      event: {
        id: "delivery-1",
        name: "pull_request.opened",
      },
      workspaceDir: "/tmp/workspace",
      parsedIntent: {
        conventionalType: { type: "fix" } as any,
      },
      diffAnalysis: {
        filesByLanguage: {
          typescript: ["src/app.ts"],
          markdown: ["README.md"],
        },
        riskSignals: ["cache", "concurrency"],
      },
      reviewFiles: ["src/app.ts"],
      authorContract: {
        state: "profile-backed",
        promptTier: "senior",
        promptPolicy: { kind: "profile-backed-senior" },
      } as any,
      config: {
        knowledge: {
          retrieval: {
            topK: 7,
            maxContextChars: 2400,
          },
        },
        telemetry: {
          enabled: true,
        },
      } as any,
      telemetryStore: {} as any,
      logger: makeLogger().logger as any,
      baseLog: { deliveryId: "delivery-1" },
      buildContext: async (params) => {
        buildCalls.push(params);
        return expectedResult as any;
      },
    });

    expect(buildCalls).toEqual([
      expect.objectContaining({
        repo: "owner/repo",
        owner: "owner",
        prNumber: 10,
        deliveryId: "delivery-1",
        eventName: "pull_request.opened",
        workspaceDir: "/tmp/workspace",
        prTitle: "Improve cache reuse",
        prBody: undefined,
        conventionalType: "fix",
        prLanguages: ["typescript", "markdown"],
        riskSignals: ["cache", "concurrency"],
        filePaths: ["src/app.ts"],
        retrievalConfig: {
          topK: 7,
          maxContextChars: 2400,
        },
        telemetryEnabled: true,
        baseLog: { deliveryId: "delivery-1" },
      }),
    ]);
    expect(result).toEqual({
      reviewRetrievalContext: expectedResult,
      retrievalCtx: expectedResult.retrievalContext,
      visibleBudgetState: expectedResult.visibleBudgetState,
      reviewPrecedentsForPrompt: expectedResult.reviewPrecedents,
      wikiKnowledgeForPrompt: expectedResult.wikiKnowledge,
      unifiedResultsForPrompt: expectedResult.unifiedResults,
      contextWindowForPrompt: expectedResult.contextWindow,
    } as any);
  });
});
