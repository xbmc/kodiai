import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import {
  evaluateExplicitMentionReviewPublish,
  extractExplicitReviewResultFindingLines,
  hasExplicitReviewBlockingSignals,
  logExplicitMentionReviewPublishSkipped,
  buildExplicitReviewLifecycleEvidenceLine,
  buildExplicitMentionReviewPublishFailureBody,
} from "./explicit-mention-review-publish.ts";

describe("extractExplicitReviewResultFindingLines", () => {
  test("extracts inline severity findings", () => {
    const lines = extractExplicitReviewResultFindingLines(
      "[CRITICAL] xbmc/addons/AddonManager.cpp (151): Undefined variable causes compilation error",
    );
    expect(lines).toEqual([
      "- (1) [critical] xbmc/addons/AddonManager.cpp (151): Undefined variable causes compilation error",
    ]);
  });
});

describe("hasExplicitReviewBlockingSignals", () => {
  test("detects blocking language and ignores clean approve summaries", () => {
    expect(hasExplicitReviewBlockingSignals("Found 3 critical issues that must be addressed before merging.")).toBeTrue();
    expect(hasExplicitReviewBlockingSignals("Decision: APPROVE\nIssues: none")).toBeFalse();
  });
});

describe("evaluateExplicitMentionReviewPublish", () => {
  test("marks output-already-published runs ineligible for approval bridge", () => {
    expect(evaluateExplicitMentionReviewPublish({
      explicitReviewRequest: true,
      prNumber: 28172,
      reviewOutputKey: "rk_test",
      result: {
        conclusion: "success",
        published: true,
        usedRepoInspectionTools: true,
        resultText: "Decision: APPROVE",
      },
    })).toMatchObject({
      eligible: false,
      skipReason: "output-already-published",
    });
  });

  test("blocks approval when unpublished findings remain in result text", () => {
    expect(evaluateExplicitMentionReviewPublish({
      explicitReviewRequest: true,
      prNumber: 28172,
      reviewOutputKey: "rk_test",
      result: {
        conclusion: "success",
        published: false,
        usedRepoInspectionTools: true,
        resultText: "[CRITICAL] src/a.ts (1): bug",
      },
    })).toMatchObject({
      eligible: false,
      skipReason: "result-text-findings",
      hasUnpublishedFindings: true,
    });
  });

  test("allows clean successful executor runs with inspection evidence", () => {
    expect(evaluateExplicitMentionReviewPublish({
      explicitReviewRequest: true,
      prNumber: 28172,
      reviewOutputKey: "rk_test",
      result: {
        conclusion: "success",
        published: false,
        usedRepoInspectionTools: true,
        resultText: "No blocking issues found.",
      },
    })).toMatchObject({
      eligible: true,
      hasUnpublishedFindings: false,
    });
  });
});

describe("buildExplicitReviewLifecycleEvidenceLine", () => {
  test("returns bounded lifecycle summary for normalized projections", () => {
    const line = buildExplicitReviewLifecycleEvidenceLine({
      projection: {
        schema: "review-finding-lifecycle.v1",
        status: "normalized",
        counts: {
          input: 6,
          recorded: 6,
          rejected: 0,
          unsafeInputFields: 0,
          status: { detected: 6, open: 6, validated: 0, degraded: 0 },
          severity: { critical: 3, major: 2, medium: 0, minor: 1 },
          actionability: { actionable: 0, "needs-human-review": 6, blocked: 0 },
        },
        rejectedReasonCodes: [],
        redaction: {
          privateOnly: true,
          unsafeInputFieldCount: 0,
        },
      },
    } as never);

    expect(line).toContain("severity=critical:3");
    expect(line).toContain("Review finding lifecycle: status=normalized");
  });
});

describe("buildExplicitMentionReviewPublishFailureBody", () => {
  test("wraps publish failures in a bounded error comment", () => {
    const body = buildExplicitMentionReviewPublishFailureBody({
      publishErr: new Error("validation failed"),
      summarizeError: (err) => (err instanceof Error ? err.message : "unknown"),
    });

    expect(body).toContain("Kodiai couldn't publish the review result");
    expect(body).toContain("validation failed");
  });
});

describe("logExplicitMentionReviewPublishSkipped", () => {
  test("logs skipped publish gate with skip reason", () => {
    const entries: Array<Record<string, unknown>> = [];
    const logger = {
      info: (bindings: Record<string, unknown>) => entries.push(bindings),
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
      child: () => logger,
    } as unknown as Logger;

    const evaluation = evaluateExplicitMentionReviewPublish({
      explicitReviewRequest: true,
      prNumber: 28172,
      reviewOutputKey: "rk_test",
      result: {
        conclusion: "success",
        published: true,
        usedRepoInspectionTools: true,
      },
    });

    logExplicitMentionReviewPublishSkipped({
      logger,
      baseLog: { repo: "xbmc/xbmc", prNumber: 28172 },
      evaluation,
      reviewOutputKey: "rk_test",
      result: evaluation.eligible ? { conclusion: "success", published: false } : {
        conclusion: "success",
        published: true,
        usedRepoInspectionTools: true,
      },
      autoApprove: false,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      gate: "explicit-review-publish",
      gateResult: "skipped",
      skipReason: "output-already-published",
      autoApprove: false,
    });
  });
});
