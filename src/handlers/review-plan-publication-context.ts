import {
  buildReviewPlanPublicationContext,
  resolveGraphValidationPlanStatus,
  type RepoDoctrinePlanProjection,
  type ReviewPlanBuilder,
  type ReviewPlanPublicationContext,
} from "../review-orchestration/review-plan.ts";
import { toProductionLogTurnBudgetFields } from "../review-audit/production-log-projection.ts";

export function buildReviewPlanPublication({
  builder,
  reviewRouting,
  changedFileCount,
  reviewRoutingLinesChanged,
  diffAnalysisLinesChanged,
  prApiLinesChanged,
  timeoutSeconds,
  appliedTimeoutSeconds,
  maxTurns,
  reviewMaxTurnsOverride,
  retrievalContextAvailable,
  matchedPathInstructionCount,
  repoDoctrineEnabled,
  repoDoctrineReviewSurface,
  reviewBoundednessAvailable,
  graphValidationConfigEnabled,
  graphQueryAvailable,
  graphQueryBypassedForTrivialChange,
  graphBlastRadiusAvailable,
}: {
  builder: ReviewPlanBuilder;
  reviewRouting: {
    taskType: string;
    routingReason: string;
  };
  changedFileCount: number;
  reviewRoutingLinesChanged: number;
  diffAnalysisLinesChanged: number;
  prApiLinesChanged: number;
  timeoutSeconds: number;
  appliedTimeoutSeconds: number | undefined;
  maxTurns: number;
  reviewMaxTurnsOverride: number | undefined;
  retrievalContextAvailable: boolean;
  matchedPathInstructionCount: number;
  repoDoctrineEnabled: boolean;
  repoDoctrineReviewSurface: Partial<RepoDoctrinePlanProjection> | null;
  reviewBoundednessAvailable: boolean;
  graphValidationConfigEnabled: boolean;
  graphQueryAvailable: boolean;
  graphQueryBypassedForTrivialChange: boolean;
  graphBlastRadiusAvailable: boolean;
}): ReviewPlanPublicationContext {
  const linesChangedSource = diffAnalysisLinesChanged === 0 && prApiLinesChanged > 0
    ? "github-pr-api-fallback"
    : "local-diff";
  const graphValidation = resolveGraphValidationPlanStatus({
    configEnabled: graphValidationConfigEnabled,
    graphQueryAvailable,
    trivialChangeBypass: graphQueryBypassedForTrivialChange,
    graphBlastRadiusAvailable,
  });

  return buildReviewPlanPublicationContext({
    input: {
      task: {
        taskType: reviewRouting.taskType,
        routingReason: reviewRouting.routingReason,
      },
      change: {
        changedFileCount,
        linesChanged: reviewRoutingLinesChanged,
        linesChangedSource,
      },
      budget: {
        timeoutSeconds: appliedTimeoutSeconds ?? timeoutSeconds,
        ...toProductionLogTurnBudgetFields(
          reviewMaxTurnsOverride ?? maxTurns,
          reviewMaxTurnsOverride !== undefined ? "dynamic-risk" : "config",
        ),
      },
      context: {
        sources: [
          "diff-analysis",
          ...(retrievalContextAvailable ? ["retrieval"] : []),
          ...(matchedPathInstructionCount > 0 ? ["path-instructions"] : []),
          ...(repoDoctrineEnabled ? ["repo-doctrine"] : []),
          ...(reviewBoundednessAvailable ? ["review-boundedness"] : []),
        ],
      },
      gates: {
        enabled: ["review-routing", "budget-estimation", "review-boundedness", ...(repoDoctrineEnabled ? ["repo-doctrine"] : [])],
        current: [
          "review-routing",
          "budget-estimation",
          ...(repoDoctrineEnabled ? ["repo-doctrine"] : []),
          ...(reviewBoundednessAvailable ? ["review-boundedness"] : []),
        ],
      },
      policy: {
        publish: "canonical-visible-surface",
        tools: "github-comment-tools",
        retry: "budget-resilience",
      },
      graphValidation,
      candidateFinding: {
        mode: "preferred",
      },
      repoDoctrine: repoDoctrineReviewSurface,
    },
    builder,
    degraded: {
      reason: "builder-error",
      message: "ReviewPlan builder failed",
      taskType: reviewRouting.taskType,
      routingReason: reviewRouting.routingReason,
    },
  });
}
