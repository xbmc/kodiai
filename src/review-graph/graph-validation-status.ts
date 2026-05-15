import type { RepoConfig } from "../execution/config.ts";
import type { ReviewPlanGateInput, ReviewPlanGateStatus } from "../review-plan/review-plan.ts";
import type { GraphValidationResult, GraphValidationFinding } from "./validation.ts";

export const GRAPH_VALIDATION_GATE = "graph-validation" as const;

export type GraphValidationPreStatus = {
  gate: typeof GRAPH_VALIDATION_GATE;
  status: ReviewPlanGateStatus;
  reason: "config-disabled" | "graph-context-unavailable" | "graph-context-available";
  enabled: boolean;
  graphContextAvailable: boolean;
};

export type GraphValidationRuntimeStatus = {
  gate: typeof GRAPH_VALIDATION_GATE;
  gateResult: "skipped" | "unavailable" | "applied" | "failure";
  reason: "config-disabled" | "graph-context-unavailable" | "validation-applied" | "no-findings-validated" | "validation-failed" | "validation-threw";
  enabled: boolean;
  graphContextAvailable: boolean;
  findingCount?: number;
  validatedCount?: number;
  confirmedCount?: number;
  uncertainCount?: number;
};

export function resolveGraphValidationPreStatus(params: {
  config: Pick<RepoConfig, "review">;
  graphContextAvailable: boolean;
}): GraphValidationPreStatus {
  const enabled = params.config.review.graphValidation.enabled;
  const graphContextAvailable = params.graphContextAvailable;

  if (!enabled) {
    return {
      gate: GRAPH_VALIDATION_GATE,
      status: "skipped",
      reason: "config-disabled",
      enabled,
      graphContextAvailable,
    };
  }

  if (!graphContextAvailable) {
    return {
      gate: GRAPH_VALIDATION_GATE,
      status: "unavailable",
      reason: "graph-context-unavailable",
      enabled,
      graphContextAvailable,
    };
  }

  return {
    gate: GRAPH_VALIDATION_GATE,
    status: "enabled",
    reason: "graph-context-available",
    enabled,
    graphContextAvailable,
  };
}

export function graphValidationGateForReviewPlan(status: GraphValidationPreStatus): ReviewPlanGateInput {
  return {
    name: GRAPH_VALIDATION_GATE,
    status: status.status,
    reason: status.reason,
  };
}

export function graphValidationSkippedRuntimeStatus(params: {
  config: Pick<RepoConfig, "review">;
  graphContextAvailable: boolean;
  findingCount?: number;
}): GraphValidationRuntimeStatus | null {
  const preStatus = resolveGraphValidationPreStatus(params);
  if (preStatus.status === "enabled") return null;

  return {
    gate: GRAPH_VALIDATION_GATE,
    gateResult: preStatus.status === "skipped" ? "skipped" : "unavailable",
    reason: preStatus.reason,
    enabled: preStatus.enabled,
    graphContextAvailable: preStatus.graphContextAvailable,
    findingCount: params.findingCount,
  };
}

export function graphValidationAppliedRuntimeStatus<T extends GraphValidationFinding>(params: {
  result: GraphValidationResult<T>;
  findingCount: number;
}): GraphValidationRuntimeStatus {
  const { result, findingCount } = params;

  if (!result.succeeded) {
    return {
      gate: GRAPH_VALIDATION_GATE,
      gateResult: "failure",
      reason: "validation-failed",
      enabled: true,
      graphContextAvailable: true,
      findingCount,
      validatedCount: result.validatedCount,
      confirmedCount: result.confirmedCount,
      uncertainCount: result.uncertainCount,
    };
  }

  return {
    gate: GRAPH_VALIDATION_GATE,
    gateResult: result.validatedCount > 0 ? "applied" : "skipped",
    reason: result.validatedCount > 0 ? "validation-applied" : "no-findings-validated",
    enabled: true,
    graphContextAvailable: true,
    findingCount,
    validatedCount: result.validatedCount,
    confirmedCount: result.confirmedCount,
    uncertainCount: result.uncertainCount,
  };
}

export function graphValidationThrownRuntimeStatus(params: {
  findingCount?: number;
} = {}): GraphValidationRuntimeStatus {
  return {
    gate: GRAPH_VALIDATION_GATE,
    gateResult: "failure",
    reason: "validation-threw",
    enabled: true,
    graphContextAvailable: true,
    findingCount: params.findingCount,
  };
}
