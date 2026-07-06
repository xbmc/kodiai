import { describe, expect, test } from "bun:test";
import type {
  ReviewPlanBuilder,
  ReviewPlanInput,
} from "../review-orchestration/review-plan.ts";
import {
  buildReviewPlan,
} from "../review-orchestration/review-plan.ts";
import { buildReviewPlanPublication } from "./review-plan-publication-context.ts";

describe("buildReviewPlanPublication", () => {
  test("builds review plan input with fallback line source and active context sources", () => {
    let capturedInput: ReviewPlanInput | undefined;
    const builder: ReviewPlanBuilder = (input) => {
      capturedInput = input;
      return buildReviewPlan(input);
    };

    const publication = buildReviewPlanPublication({
      builder,
      reviewRouting: {
        taskType: "review-full",
        routingReason: "standard",
      },
      changedFileCount: 4,
      reviewRoutingLinesChanged: 88,
      diffAnalysisLinesChanged: 0,
      prApiLinesChanged: 88,
      timeoutSeconds: 120,
      appliedTimeoutSeconds: 240,
      maxTurns: 12,
      reviewMaxTurnsOverride: 8,
      retrievalContextAvailable: true,
      matchedPathInstructionCount: 2,
      repoDoctrineEnabled: true,
      repoDoctrineReviewSurface: {
        status: "applied",
        contractCount: 3,
        matchedCount: 2,
        omittedCount: 1,
        reasonCodes: ["matched"],
      },
      reviewBoundednessAvailable: true,
      graphValidationConfigEnabled: true,
      graphQueryAvailable: true,
      graphQueryBypassedForTrivialChange: false,
      graphBlastRadiusAvailable: true,
    });

    expect(publication.status).toBe("ready");
    expect(capturedInput).toMatchObject({
      task: {
        taskType: "review-full",
        routingReason: "standard",
      },
      change: {
        changedFileCount: 4,
        linesChanged: 88,
        linesChangedSource: "github-pr-api-fallback",
      },
      budget: {
        timeoutSeconds: 240,
        turnBudget: 8,
        turnBudgetSource: "dynamic-risk",
      },
      context: {
        sources: [
          "diff-analysis",
          "retrieval",
          "path-instructions",
          "repo-doctrine",
          "review-boundedness",
        ],
      },
      gates: {
        enabled: ["review-routing", "budget-estimation", "review-boundedness", "repo-doctrine"],
        current: ["review-routing", "budget-estimation", "repo-doctrine", "review-boundedness"],
      },
      graphValidation: {
        status: "enabled",
        reason: "graph-blast-radius-available",
      },
      candidateFinding: {
        mode: "preferred",
      },
    });
  });

  test("uses local diff line source and degraded plan metadata when the builder throws", () => {
    const publication = buildReviewPlanPublication({
      builder: () => {
        throw new Error("builder failed");
      },
      reviewRouting: {
        taskType: "review-minimal",
        routingReason: "tiny-diff",
      },
      changedFileCount: 1,
      reviewRoutingLinesChanged: 7,
      diffAnalysisLinesChanged: 7,
      prApiLinesChanged: 9,
      timeoutSeconds: 90,
      appliedTimeoutSeconds: undefined,
      maxTurns: 6,
      reviewMaxTurnsOverride: undefined,
      retrievalContextAvailable: false,
      matchedPathInstructionCount: 0,
      repoDoctrineEnabled: false,
      repoDoctrineReviewSurface: null,
      reviewBoundednessAvailable: false,
      graphValidationConfigEnabled: false,
      graphQueryAvailable: false,
      graphQueryBypassedForTrivialChange: false,
      graphBlastRadiusAvailable: false,
    });

    expect(publication.status).toBe("degraded");
    expect(publication.error).toBeInstanceOf(Error);
    expect(publication.plan.status).toBe("degraded");
    expect(publication.detailsSummary.status).toBe("degraded");
    if (publication.plan.status !== "degraded") throw new Error("expected degraded plan");
    expect(publication.plan.task).toMatchObject({
      taskType: "review-minimal",
      routingReason: "tiny-diff",
    });
  });
});
