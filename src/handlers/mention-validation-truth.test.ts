import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import {
  attachReviewFindingLifecycle,
} from "../review-lifecycle/handler-lifecycle.ts";
import { projectExplicitMentionReviewValidationTruth } from "./mention-validation-truth.ts";

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
    source: "mention",
    trigger: "issue_comment",
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
      title: "Validate lifecycle",
      actionability: "needs-human-review",
    }],
  });
}

describe("projectExplicitMentionReviewValidationTruth", () => {
  test("logs private validation-truth evidence for explicit mention reviews", () => {
    const { logger, info, warn } = createLogger();
    const lifecycleResult = createLifecycleResult();

    const result = projectExplicitMentionReviewValidationTruth({
      logger,
      surface: "issue_comment",
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
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.status : null).toBe("normalized");
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(info.mock.calls[0]?.[0]).toMatchObject({
      surface: "issue_comment",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      gate: "review-validation-truth",
      gateResult: "normalized",
      source: "explicit-mention-review",
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      counts: expect.objectContaining({ detected: 1, open: 1 }),
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
    expect(info.mock.calls[0]?.[1]).toBe("Projected explicit mention review validation truth evidence");
  });

  test("swallows validation-truth diagnostics failures and emits degraded warning", () => {
    const { logger, info, warn } = createLogger();
    const lifecycleResult = createLifecycleResult();
    const err = new Error("projection failed");

    const result = projectExplicitMentionReviewValidationTruth({
      logger,
      surface: "issue_comment",
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
      attachValidationTruth: () => {
        throw err;
      },
    });

    expect(result).toEqual({ ok: false, err });
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      err,
      surface: "issue_comment",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      gate: "review-validation-truth",
      gateResult: "degraded",
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
    });
    expect(warn.mock.calls[0]?.[1]).toBe(
      "Explicit mention review validation truth diagnostics failed; continuing review publication",
    );
  });

  test("keeps diagnostics fail-open when degraded warning logging also fails", () => {
    const lifecycleResult = createLifecycleResult();

    const result = projectExplicitMentionReviewValidationTruth({
      logger: {
        info: mock(() => {}),
        warn: mock(() => {
          throw new Error("logger unavailable");
        }),
      } as unknown as Pick<Logger, "info" | "warn">,
      surface: "issue_comment",
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
      attachValidationTruth: () => {
        throw new Error("projection failed");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.err.message).toBe("projection failed");
  });
});
