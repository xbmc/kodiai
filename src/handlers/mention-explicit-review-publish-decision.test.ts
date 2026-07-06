import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type {
  ExplicitMentionReviewExecutionSnapshot,
  ExplicitMentionReviewPublishEvaluation,
} from "../review-orchestration/explicit-mention-review-publish.ts";
import { resolveExplicitMentionReviewPublishDecision } from "./mention-explicit-review-publish-decision.ts";

function makeEvaluation(
  overrides: Partial<ExplicitMentionReviewPublishEvaluation> = {},
): ExplicitMentionReviewPublishEvaluation {
  return {
    eligible: false,
    skipReason: "missing-inspection-evidence",
    findingLines: [],
    hasUnpublishedFindings: false,
    ...overrides,
  };
}

function makeResult(
  overrides: Partial<ExplicitMentionReviewExecutionSnapshot> = {},
): ExplicitMentionReviewExecutionSnapshot {
  return {
    conclusion: "success",
    published: false,
    usedRepoInspectionTools: true,
    resultText: "clean",
    toolUseNames: ["repo.read"],
    ...overrides,
  };
}

describe("resolveExplicitMentionReviewPublishDecision", () => {
  test("returns eligible evaluation without logging a skip", () => {
    const evaluation = makeEvaluation({
      eligible: true,
      skipReason: undefined,
      findingLines: ["src/app.ts:10: issue"],
    });
    const logCalls: unknown[] = [];
    const logger = { info: () => logCalls.push("unexpected") } as unknown as Logger;

    const decision = resolveExplicitMentionReviewPublishDecision({
      explicitReviewRequest: true,
      prNumber: 42,
      reviewOutputKey: "review-output",
      result: makeResult(),
      surface: "issue_comment",
      owner: "acme",
      repo: "widgets",
      autoApprove: true,
      logger,
      evaluatePublish: () => evaluation,
      logSkipped: () => logCalls.push("unexpected"),
    });

    expect(decision).toEqual({
      evaluation,
      findingLines: ["src/app.ts:10: issue"],
      eligible: true,
    });
    expect(logCalls).toEqual([]);
  });

  test("logs ineligible explicit PR review decisions with publish context", () => {
    const evaluation = makeEvaluation({
      skipReason: "missing-inspection-evidence",
      findingLines: ["src/app.ts:10: issue"],
    });
    const result = makeResult({ usedRepoInspectionTools: false });
    const logCalls: Array<Record<string, unknown>> = [];
    const logger = { info: () => undefined } as unknown as Logger;

    const decision = resolveExplicitMentionReviewPublishDecision({
      explicitReviewRequest: true,
      prNumber: 42,
      reviewOutputKey: "review-output",
      result,
      surface: "pr_review_comment",
      owner: "acme",
      repo: "widgets",
      autoApprove: false,
      logger,
      evaluatePublish: () => evaluation,
      logSkipped: (params) => logCalls.push(params),
    });

    expect(decision.eligible).toBe(false);
    expect(decision.findingLines).toEqual(["src/app.ts:10: issue"]);
    expect(logCalls).toEqual([
      {
        logger: { info: expect.any(Function) },
        baseLog: {
          surface: "pr_review_comment",
          owner: "acme",
          repo: "widgets",
          prNumber: 42,
        },
        evaluation,
        reviewOutputKey: "review-output",
        result: {
          conclusion: "success",
          published: false,
          usedRepoInspectionTools: false,
          toolUseNames: ["repo.read"],
        },
        autoApprove: false,
      },
    ]);
  });

  test("does not log skip decisions for non-explicit or non-PR mentions", () => {
    const evaluation = makeEvaluation();
    const result = makeResult();
    const logCalls: unknown[] = [];
    const logger = { info: () => undefined } as unknown as Logger;

    resolveExplicitMentionReviewPublishDecision({
      explicitReviewRequest: false,
      prNumber: 42,
      reviewOutputKey: "review-output",
      result,
      surface: "issue_comment",
      owner: "acme",
      repo: "widgets",
      autoApprove: true,
      logger,
      evaluatePublish: () => evaluation,
      logSkipped: () => logCalls.push("unexpected"),
    });
    resolveExplicitMentionReviewPublishDecision({
      explicitReviewRequest: true,
      prNumber: undefined,
      reviewOutputKey: "review-output",
      result,
      surface: "issue_comment",
      owner: "acme",
      repo: "widgets",
      autoApprove: true,
      logger,
      evaluatePublish: () => evaluation,
      logSkipped: () => logCalls.push("unexpected"),
    });

    expect(logCalls).toEqual([]);
  });
});
