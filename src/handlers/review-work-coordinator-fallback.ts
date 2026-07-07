import {
  createReviewWorkCoordinator,
  type ReviewWorkCoordinator,
} from "../jobs/review-work-coordinator.ts";

const PRIVATE_COORDINATOR_FALLBACK_MESSAGE =
  "Review work coordinator not injected; using a private handler-local fallback (cross-handler coordination disabled)";

type ReviewWorkCoordinatorFallbackLogger = {
  warn(fields: Record<string, unknown>, message: string): void;
};

export function resolveReviewWorkCoordinator(params: {
  injected: ReviewWorkCoordinator | undefined;
  handler: "review" | "mention";
  logger: ReviewWorkCoordinatorFallbackLogger;
}): ReviewWorkCoordinator {
  if (params.injected) {
    return params.injected;
  }

  params.logger.warn(
    {
      gate: "review-family-coordinator",
      gateResult: "private-fallback",
      coordinationScope: "handler-local",
      handler: params.handler,
    },
    PRIVATE_COORDINATOR_FALLBACK_MESSAGE,
  );
  return createReviewWorkCoordinator();
}
