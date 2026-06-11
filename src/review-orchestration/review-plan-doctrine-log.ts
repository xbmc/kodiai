import type { DegradedReviewPlan, ReviewPlan } from "./review-plan.ts";
import type { RepoDoctrineProjection } from "../repo-doctrine/contracts.ts";

type RepoDoctrineReviewSurfaceInput = Pick<
  RepoDoctrineProjection,
  | "enabled"
  | "contractCount"
  | "consumedContractCount"
  | "matchedPathCandidateCount"
  | "omittedContractCount"
  | "omittedMatchedPathCandidateCount"
  | "reasonCodes"
>;

export type RepoDoctrineReviewSurfaceProjection = {
  status: "disabled" | "skipped" | "degraded" | "applied";
  contractCount: number;
  matchedCount: number;
  omittedCount: number;
  reasonCodes: string[];
};

export function toRepoDoctrineReviewSurfaceProjection(doctrine: RepoDoctrineReviewSurfaceInput): RepoDoctrineReviewSurfaceProjection {
  const status: RepoDoctrineReviewSurfaceProjection["status"] = !doctrine.enabled
    ? "disabled"
    : doctrine.consumedContractCount > 0
      ? "applied"
      : doctrine.reasonCodes.length > 0
        ? "degraded"
        : "skipped";
  const omittedCount = doctrine.omittedContractCount + doctrine.omittedMatchedPathCandidateCount;
  const reasonCodes = doctrine.reasonCodes.length > 0
    ? doctrine.reasonCodes
    : status === "applied"
      ? ["none"]
      : [status];

  return {
    status,
    contractCount: doctrine.contractCount,
    matchedCount: doctrine.matchedPathCandidateCount,
    omittedCount,
    reasonCodes,
  };
}

export function buildRepoDoctrineLogFields(doctrine: RepoDoctrineReviewSurfaceInput): Record<string, unknown> {
  const projection = toRepoDoctrineReviewSurfaceProjection(doctrine);
  return {
    repoDoctrineStatus: projection.status,
    repoDoctrineContractCount: projection.contractCount,
    repoDoctrineConsumedContractCount: doctrine.consumedContractCount,
    repoDoctrineMatchedPathCandidateCount: projection.matchedCount,
    repoDoctrineOmittedCount: projection.omittedCount,
    repoDoctrineReasonCodes: projection.reasonCodes.slice(0, 8),
  };
}

export type ReviewPlanConfigSnapshot = {
  status: ReviewPlan["status"] | DegradedReviewPlan["status"];
  hash: string;
  taskType?: string;
  routingReason?: string;
  graphValidationStatus: ReviewPlan["graphValidation"]["status"] | DegradedReviewPlan["graphValidation"]["status"];
  candidateFindingMode: ReviewPlan["candidateFinding"]["mode"] | DegradedReviewPlan["candidateFinding"]["mode"];
  repoDoctrine?: RepoDoctrineReviewSurfaceProjection;
  degradedReason?: string;
};

export function toReviewPlanConfigSnapshot(plan: ReviewPlan | DegradedReviewPlan): ReviewPlanConfigSnapshot {
  if (plan.status === "degraded") {
    return {
      status: plan.status,
      hash: plan.hash,
      taskType: plan.task.taskType,
      routingReason: plan.task.routingReason,
      graphValidationStatus: plan.graphValidation.status,
      candidateFindingMode: plan.candidateFinding.mode,
      degradedReason: plan.degraded.reason,
    };
  }

  return {
    status: plan.status,
    hash: plan.hash,
    taskType: plan.task.taskType,
    routingReason: plan.task.routingReason,
    graphValidationStatus: plan.graphValidation.status,
    candidateFindingMode: plan.candidateFinding.mode,
    repoDoctrine: plan.repoDoctrine,
  };
}

export function serializeReviewPlanBuilderError(err: unknown): { name: string; message: string } {
  return {
    name: err instanceof Error && err.name ? err.name : "Error",
    message: "ReviewPlan builder failed",
  };
}
