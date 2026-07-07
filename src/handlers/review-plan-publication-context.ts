import type { Logger } from "pino";
import {
  buildReviewPlanPublicationContext,
  resolveGraphValidationPlanStatus,
  type RepoDoctrinePlanProjection,
  type ReviewPlanBuilder,
  type ReviewPlanPublicationContext,
} from "../review-orchestration/review-plan.ts";
import { toProductionLogTurnBudgetFields } from "../review-audit/production-log-projection.ts";
import {
  buildRepoDoctrineLogFields,
  serializeReviewPlanBuilderError,
} from "../review-orchestration/review-plan-doctrine-log.ts";

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

export function logReviewPlanPublication(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  publication: ReviewPlanPublicationContext;
  reviewRouting: {
    taskType: string;
    routingReason: string;
  };
  reviewBoundedness?: {
    disclosureRequired?: boolean;
    reasonCodes?: string[];
  } | null;
  repoDoctrineProjection: Parameters<typeof buildRepoDoctrineLogFields>[0];
}): void {
  const { logger, baseLog, publication, reviewRouting, reviewBoundedness, repoDoctrineProjection } = params;
  const { plan } = publication;

  if (publication.status === "ready") {
    logger.info(
      {
        ...baseLog,
        gate: "review-plan",
        gateResult: "ready",
        planHash: plan.hash,
        taskType: plan.task.taskType,
        routingReason: plan.task.routingReason,
        boundedDisclosureRequired: reviewBoundedness?.disclosureRequired ?? false,
        boundedReasonCodes: reviewBoundedness?.reasonCodes ?? [],
        graphValidationStatus: plan.graphValidation.status,
        candidateFindingMode: plan.candidateFinding.mode,
        ...buildRepoDoctrineLogFields(repoDoctrineProjection),
      },
      "Review plan ready",
    );
    return;
  }

  logger.warn(
    {
      ...baseLog,
      gate: "review-plan",
      gateResult: "degraded",
      planHash: plan.hash,
      taskType: reviewRouting.taskType,
      routingReason: reviewRouting.routingReason,
      boundedDisclosureRequired: reviewBoundedness?.disclosureRequired ?? false,
      boundedReasonCodes: reviewBoundedness?.reasonCodes ?? [],
      graphValidationStatus: plan.graphValidation.status,
      candidateFindingMode: plan.candidateFinding.mode,
      ...buildRepoDoctrineLogFields(repoDoctrineProjection),
      error: serializeReviewPlanBuilderError(publication.error),
    },
    "Review plan builder failed; continuing with degraded plan metadata",
  );
}
