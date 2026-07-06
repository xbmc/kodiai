import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { InlineReviewPublicationResult } from "../execution/mcp/inline-review-publisher.ts";
import {
  attachReviewFindingLifecycle,
} from "../review-lifecycle/handler-lifecycle.ts";
import type { ReviewCandidatePublicationAdapterResult } from "../review-orchestration/review-candidate-publication-adapter.ts";
import { projectAutomaticReviewValidationTruth } from "./review-validation-truth.ts";

function createLogger() {
  const info = mock((_bindings: Record<string, unknown>, _message: string) => {});
  const warn = mock((_bindings: Record<string, unknown>, _message: string) => {});
  return {
    logger: { info, warn } as unknown as Pick<Logger, "info" | "warn">,
    info,
    warn,
  };
}

function createLifecycleResult() {
  return attachReviewFindingLifecycle({
    source: "automatic",
    trigger: "pull_request",
    correlation: {
      repo: "acme/widgets",
      pullNumber: 42,
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      commitSha: "head-sha",
      headSha: "head-sha",
      baseSha: "base-sha",
      headRef: "feature",
      baseRef: "main",
    },
    findings: [{
      filePath: "src/widget.ts",
      startLine: 12,
      severity: "major",
      category: "correctness",
      title: "Validate automatic lifecycle",
      actionability: "needs-human-review",
    }],
  });
}

function createCandidatePublicationAdapter(): Pick<ReviewCandidatePublicationAdapterResult, "payloads"> {
  return {
    payloads: [{
      candidateFingerprint: "candidate-fp-1",
      candidatePublicationLifecycle: "approved",
      source: "candidate",
      publication: {
        location: {
          path: "src/widget.ts",
          line: 12,
          side: "RIGHT",
        },
        body: "Consider tightening this branch.",
      },
      finding: {
        filePath: "src/widget.ts",
        startLine: 12,
        endLine: 12,
        severity: "major",
        category: "correctness",
        title: "Validate automatic lifecycle",
        body: "Consider tightening this branch.",
        confidence: 90,
      },
    }],
  };
}

describe("projectAutomaticReviewValidationTruth", () => {
  test("logs private validation-truth evidence and returns the projection", () => {
    const { logger, info, warn } = createLogger();
    const lifecycleResult = createLifecycleResult();
    const candidatePublisherResults = new Map<string, InlineReviewPublicationResult>([
      ["candidate-fp-1", {
        status: "published",
        commentId: 123,
        content: [{ type: "text", text: "published" }],
      }],
    ]);

    const result = projectAutomaticReviewValidationTruth({
      logger,
      baseLog: {
        owner: "acme",
        repo: "widgets",
        prNumber: 42,
      },
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      headSha: "head-sha",
      baseSha: "base-sha",
      headRef: "feature",
      baseRef: "main",
      lifecycleResult,
      candidatePublicationPayloads: createCandidatePublicationAdapter().payloads,
      candidatePublisherResults,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.status : null).toBe("degraded");
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(info.mock.calls[0]?.[0]).toMatchObject({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      gate: "review-validation-truth",
      gateResult: "degraded",
      source: "automatic-review",
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      counts: expect.objectContaining({
        detected: 1,
        degraded: 1,
        suggested: 0,
        open: 0,
      }),
      reasonCounts: { degraded: 1 },
      evidenceFreshness: {
        fresh: 0,
        stale: 0,
        missingValidation: 1,
        missingRevalidation: 1,
      },
      redaction: expect.objectContaining({
        privateOnly: true,
        rawPromptsIncluded: false,
        rawModelOutputIncluded: false,
        candidateBodiesIncluded: false,
        replacementTextIncluded: false,
        toolPayloadsIncluded: false,
        diffsIncluded: false,
      }),
    });
    expect(info.mock.calls[0]?.[1]).toBe("Projected review validation truth evidence");
  });

  test("swallows validation-truth diagnostics failures and emits degraded warning", () => {
    const { logger, info, warn } = createLogger();
    const lifecycleResult = createLifecycleResult();
    const err = new Error("projection failed");

    const result = projectAutomaticReviewValidationTruth({
      logger,
      baseLog: {
        owner: "acme",
        repo: "widgets",
        prNumber: 42,
      },
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      headSha: "head-sha",
      baseSha: "base-sha",
      headRef: "feature",
      baseRef: "main",
      lifecycleResult,
      candidatePublicationPayloads: createCandidatePublicationAdapter().payloads,
      candidatePublisherResults: new Map(),
      attachValidationTruth: () => {
        throw err;
      },
    });

    expect(result).toEqual({ ok: false, err });
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      err,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      gate: "review-validation-truth",
      gateResult: "degraded",
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
    });
    expect(warn.mock.calls[0]?.[1]).toBe(
      "Review validation truth diagnostics failed; continuing review publication",
    );
  });

  test("keeps diagnostics fail-open when degraded warning logging also fails", () => {
    const lifecycleResult = createLifecycleResult();

    const result = projectAutomaticReviewValidationTruth({
      logger: {
        info: mock(() => {}),
        warn: mock(() => {
          throw new Error("logger unavailable");
        }),
      } as unknown as Pick<Logger, "info" | "warn">,
      baseLog: {},
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      headSha: "head-sha",
      baseSha: "base-sha",
      headRef: "feature",
      baseRef: "main",
      lifecycleResult,
      candidatePublicationPayloads: createCandidatePublicationAdapter().payloads,
      candidatePublisherResults: new Map(),
      attachValidationTruth: () => {
        throw new Error("projection failed");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.err.message).toBe("projection failed");
  });
});
