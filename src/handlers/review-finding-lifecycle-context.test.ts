import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { InlineReviewPublicationResult } from "../execution/mcp/inline-review-publisher.ts";
import type { ProcessedReviewFinding } from "../review-orchestration/review-reducer.ts";
import { resolveReviewFindingLifecycleContext } from "./review-finding-lifecycle-context.ts";

function finding(): ProcessedReviewFinding {
  return {
    commentId: 101,
    filePath: "src/widget.ts",
    title: "Validate lifecycle context",
    body: "Body",
    severity: "major",
    category: "correctness",
    confidence: 90,
    suppressed: false,
  };
}

describe("resolveReviewFindingLifecycleContext", () => {
  test("projects lifecycle evidence and validation-truth evidence for automatic review findings", () => {
    const info = mock((_bindings: Record<string, unknown>, _message: string) => {});
    const warn = mock((_bindings: Record<string, unknown>, _message: string) => {});
    const candidatePublisherResults = new Map<string, InlineReviewPublicationResult>();

    const result = resolveReviewFindingLifecycleContext({
      logger: { info, warn } as unknown as Logger,
      baseLog: { owner: "acme", repo: "widgets", prNumber: 42 },
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      headSha: "head-sha",
      baseSha: "base-sha",
      headRef: "feature",
      baseRef: "main",
      findings: [finding()],
      candidatePublicationPayloads: [],
      candidatePublisherResults,
    });

    expect(result.lifecycleResult.status).toBe("normalized");
    expect(result.validationTruthProjection?.status).toBe("normalized");
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[0]?.[0]).toMatchObject({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      gate: "review-finding-lifecycle",
      source: "automatic-review",
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
    });
    expect(info.mock.calls[0]?.[1]).toBe("Projected review finding lifecycle evidence");
    expect(info.mock.calls[1]?.[0]).toMatchObject({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      gate: "review-validation-truth",
      source: "automatic-review",
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
