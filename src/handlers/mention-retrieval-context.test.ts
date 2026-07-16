import { describe, expect, mock, test } from "bun:test";
import { buildMentionRetrievalContextForPrompt } from "./mention-retrieval-context.ts";

function createLogger() {
  return {
    warn: mock(() => {}),
  };
}

function createFindingResult() {
  return {
    findings: [{
      record: {
        findingText: "Prefer explicit error handling",
        severity: "major",
        category: "correctness",
        filePath: "src/a.ts",
        outcome: "accepted",
      },
      distance: 0.12,
      sourceRepo: "octo/repo",
    }],
    snippetAnchors: [{ path: "src/a.ts", line: 12, snippet: "throw err;" }],
    reviewPrecedents: [{ id: 1 }] as never,
    wikiKnowledge: [{ id: 2 }] as never,
    unifiedResults: [{ id: "u1" }] as never,
    contextWindow: "unified context",
    provenance: {
      embeddingRequests: 2,
      embeddingCacheHits: 1,
    },
  } as never;
}

describe("buildMentionRetrievalContextForPrompt", () => {
  test("runs multi-query retrieval with normalized PR languages and records reuse telemetry", async () => {
    const retrieve = mock(async (_input: unknown) => createFindingResult());
    const recordRateLimitEvent = mock(async (_entry: unknown) => {});
    const collectDiffFilePaths = mock(async () => ({
      exitCode: 0,
      stdout: ["src/a.ts", "include/widget.h", "scripts/tool.py"].join("\n"),
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    }));

    const result = await buildMentionRetrievalContextForPrompt({
      retriever: { retrieve } as never,
      retrievalEnabled: true,
      topK: 10,
      telemetryEnabled: true,
      telemetryStore: { recordRateLimitEvent },
      deliveryId: "delivery-1",
      owner: "octo",
      repo: "repo",
      surface: "pull_request_review_comment",
      issueNumber: 7,
      prNumber: 42,
      baseRef: "main",
      workspaceDir: "/tmp/work",
      writeRequest: "Please explain this change",
      mentionContext: "Thread context",
      allowHeavyContext: false,
      allowDiffContext: true,
      explicitReviewRequest: false,
      inReplyToId: 99,
      includeIssueCorpus: false,
      logger: createLogger(),
      collectDiffFilePaths,
    });

    expect(retrieve).toHaveBeenCalledTimes(1);
    const retrieveInput = retrieve.mock.calls[0]?.[0] as {
      queries: string[];
      prLanguages: string[];
      topK: number;
      includeIssues: boolean;
    };
    expect(retrieveInput.queries).toHaveLength(3);
    expect(retrieveInput.prLanguages).toEqual(["typescript", "c", "python"]);
    expect(retrieveInput.topK).toBe(3);
    expect(retrieveInput.includeIssues).toBe(false);
    expect(recordRateLimitEvent).toHaveBeenCalledWith({
      deliveryId: "delivery-1",
      executionIdentity: "delivery-1:reuse.retrieval-query-embedding.mention",
      repo: "octo/repo",
      prNumber: 42,
      eventType: "reuse.retrieval-query-embedding.mention",
      cacheHitRate: 1 / 3,
      skippedQueries: 1,
      retryAttempts: 2,
      degradationPath: "hit",
    });
    expect(result.retrievalContext).toEqual({
      maxChars: 1200,
      maxItems: 3,
      findings: [{
        findingText: "Prefer explicit error handling",
        severity: "major",
        category: "correctness",
        path: "src/a.ts",
        line: 12,
        snippet: "throw err;",
        outcome: "accepted",
        distance: 0.12,
        sourceRepo: "octo/repo",
      }],
    });
    expect(result.unifiedResultsForPrompt as unknown[]).toEqual([{ id: "u1" }]);
    expect(result.contextWindowForPrompt).toBe("unified context");
    expect(result.reviewPrecedentsForPrompt as unknown[]).toEqual([{ id: 1 }]);
    expect(result.wikiKnowledgeForPrompt as unknown[]).toEqual([{ id: 2 }]);
  });

  test("drops file-backed retrieval from paths outside the current PR diff", async () => {
    const retrieve = mock(async (_input: unknown) => {
      const baseResult = createFindingResult() as Record<string, unknown>;
      return {
        ...baseResult,
        findings: [
          {
            record: {
              findingText: "Keyboard layout sorting should compare label",
              severity: "major",
              category: "correctness",
              filePath: "xbmc/input/keyboard/KeyboardLayoutManager.cpp",
              outcome: "accepted",
            },
            distance: 0.01,
            sourceRepo: "xbmc/xbmc",
          },
          {
            record: {
              findingText: "Remote control key mapping context",
              severity: "minor",
              category: "input",
              filePath: "xbmc/platform/linux/input/LibInputKeyboard.cpp",
              outcome: "accepted",
            },
            distance: 0.02,
            sourceRepo: "xbmc/xbmc",
          },
        ],
        snippetAnchors: [
          {
            path: "xbmc/input/keyboard/KeyboardLayoutManager.cpp",
            line: 136,
            snippet: "return (i.value < j.value);",
          },
          {
            path: "xbmc/platform/linux/input/LibInputKeyboard.cpp",
            line: 523,
            snippet: "haveEvdevMapping",
          },
        ],
        unifiedResults: [
          {
            id: "review:xbmc/xbmc:28529:0",
            text: "To revert the sorting change, edit xbmc/input/keyboard/KeyboardLayoutManager.cpp:136.",
            source: "review_comment",
            sourceLabel: "[review: prior review comment]",
            sourceUrl: null,
            vectorDistance: 0.01,
            rrfScore: 1,
            createdAt: "2026-07-16T08:35:45Z",
            metadata: {
              prNumber: 28529,
              filePath: "xbmc/input/keyboard/KeyboardLayoutManager.cpp",
            },
          },
          {
            id: "review:xbmc/xbmc:28497:0",
            text: "Remote control key mapping context.",
            source: "review_comment",
            sourceLabel: "[review: prior review comment]",
            sourceUrl: null,
            vectorDistance: 0.02,
            rrfScore: 0.8,
            createdAt: "2026-07-16T08:45:04Z",
            metadata: {
              prNumber: 28497,
              filePath: "xbmc/platform/linux/input/LibInputKeyboard.cpp",
            },
          },
        ],
        contextWindow: [
          "[review: prior review comment]: To revert the sorting change, edit xbmc/input/keyboard/KeyboardLayoutManager.cpp:136.",
          "",
          "[review: prior review comment]: Remote control key mapping context.",
        ].join("\n"),
      };
    });
    const collectDiffFilePaths = mock(async () => ({
      exitCode: 0,
      stdout: [
        "system/keymaps/keyboard.xml",
        "xbmc/platform/linux/input/LibInputKeyboard.cpp",
        "xbmc/input/keyboard/XBMC_keytable.cpp",
      ].join("\n"),
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    }));

    const result = await buildMentionRetrievalContextForPrompt({
      retriever: { retrieve } as never,
      retrievalEnabled: true,
      topK: 5,
      telemetryEnabled: false,
      telemetryStore: {},
      deliveryId: "delivery-28497",
      owner: "xbmc",
      repo: "xbmc",
      surface: "issue_comment",
      issueNumber: 28497,
      prNumber: 28497,
      baseRef: "master",
      workspaceDir: "/tmp/work",
      writeRequest: "how do you repent?",
      mentionContext: "Conversation mentions a bad review on this PR.",
      allowHeavyContext: false,
      allowDiffContext: true,
      explicitReviewRequest: false,
      inReplyToId: undefined,
      includeIssueCorpus: false,
      logger: createLogger(),
      collectDiffFilePaths,
    });

    expect(result.contextWindowForPrompt).not.toContain("KeyboardLayoutManager.cpp");
    expect(result.contextWindowForPrompt).not.toContain("sorting change");
    expect(result.unifiedResultsForPrompt).toHaveLength(1);
    expect(result.unifiedResultsForPrompt[0]?.metadata.filePath).toBe("xbmc/platform/linux/input/LibInputKeyboard.cpp");
    expect(result.retrievalContext?.findings).toEqual([
      {
        findingText: "Remote control key mapping context",
        severity: "minor",
        category: "input",
        path: "xbmc/platform/linux/input/LibInputKeyboard.cpp",
        line: 523,
        snippet: "haveEvdevMapping",
        outcome: "accepted",
        distance: 0.02,
        sourceRepo: "xbmc/xbmc",
      },
    ]);
  });

  test("logs and returns empty prompt context when retrieval throws", async () => {
    const err = new Error("retrieval failed");
    const logger = createLogger();

    const result = await buildMentionRetrievalContextForPrompt({
      retriever: { retrieve: mock(async () => { throw err; }) } as never,
      retrievalEnabled: true,
      topK: 3,
      telemetryEnabled: false,
      telemetryStore: {},
      deliveryId: "delivery-1",
      owner: "octo",
      repo: "repo",
      surface: "issue_comment",
      issueNumber: 7,
      prNumber: undefined,
      baseRef: undefined,
      workspaceDir: "/tmp/work",
      writeRequest: "What should we do?",
      mentionContext: "",
      allowHeavyContext: false,
      allowDiffContext: false,
      explicitReviewRequest: false,
      inReplyToId: undefined,
      includeIssueCorpus: true,
      logger,
    });

    expect(result).toEqual({
      retrievalContext: undefined,
      unifiedResultsForPrompt: [],
      contextWindowForPrompt: undefined,
      reviewPrecedentsForPrompt: [],
      wikiKnowledgeForPrompt: [],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      {
        err,
        surface: "issue_comment",
        owner: "octo",
        repo: "repo",
        issueNumber: 7,
        prNumber: undefined,
      },
      "Mention retrieval context generation failed (fail-open)",
    );
  });
});
