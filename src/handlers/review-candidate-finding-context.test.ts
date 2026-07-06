import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { ExtractedFinding } from "../review-orchestration/review-comment-finding-extraction.ts";
import { resolveReviewCandidateFindingContext } from "./review-candidate-finding-context.ts";

describe("resolveReviewCandidateFindingContext", () => {
  test("normalizes candidate finding state and extracts review comments after successful execution", async () => {
    const infoEntries: unknown[] = [];
    const logger = {
      info: (fields: unknown) => infoEntries.push(fields),
      warn: () => {
        throw new Error("unexpected warning");
      },
    } as unknown as Logger;
    const extractedFindings: ExtractedFinding[] = [{
      commentId: 101,
      filePath: "src/example.ts",
      title: "Check this",
      severity: "medium",
      category: "correctness",
      startLine: 12,
      endLine: 13,
    }];
    let extractCalls = 0;
    const octokit = { fake: "octokit" } as never;

    const context = await resolveReviewCandidateFindingContext({
      candidateFinding: {
        status: "shadow",
        counts: { input: 1, recorded: 1, rejected: 0, errors: 0 },
        artifactPresent: true,
        findings: [{
          filePath: "src/example.ts",
          title: "Candidate title",
          body: "Candidate body",
          severity: "medium",
          category: "correctness",
        }],
      },
      executionSucceeded: true,
      octokit,
      extractFindings: async (params) => {
        extractCalls++;
        expect(params.octokit).toBe(octokit);
        expect(params.owner).toBe("xbmc");
        expect(params.repo).toBe("kodiai");
        expect(params.prNumber).toBe(42);
        expect(params.reviewOutputKey).toBe("review-output-1");
        return extractedFindings;
      },
      logger,
      baseLog: { deliveryId: "delivery-1" },
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      reviewOutputKey: "review-output-1",
      deliveryId: "delivery-1",
    });

    expect(context.extractedFindings).toBe(extractedFindings);
    expect(context.result.status).toBe("shadow");
    expect(context.detailsSummary.status).toBe("shadow");
    expect(context.configSnapshot).toMatchObject({
      status: "shadow",
      recorded: 1,
      rejected: 0,
      errors: 0,
      artifactPresent: true,
    });
    expect(extractCalls).toBe(1);
    expect(infoEntries).toHaveLength(1);
    expect(infoEntries[0]).toMatchObject({
      deliveryId: "delivery-1",
      gate: "review-candidate-finding",
      gateResult: "shadow",
    });
  });

  test("skips review comment extraction for non-success execution", async () => {
    const logger = {
      info: () => {},
      warn: () => {},
    } as unknown as Logger;
    let extractCalls = 0;

    const context = await resolveReviewCandidateFindingContext({
      candidateFinding: undefined,
      executionSucceeded: false,
      octokit: {} as never,
      extractFindings: async () => {
        extractCalls++;
        return [];
      },
      logger,
      baseLog: {},
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      reviewOutputKey: "review-output-1",
      deliveryId: "delivery-1",
    });

    expect(context.extractedFindings).toEqual([]);
    expect(context.result.status).toBe("unavailable");
    expect(extractCalls).toBe(0);
  });
});
