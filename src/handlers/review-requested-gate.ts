import type { Logger } from "pino";
import { normalizeReviewerLogin } from "../lib/review-trigger-utils.ts";

type ReviewRequestedLogger = Pick<Logger, "info" | "warn">;

export type ReviewRequestedGateDecision =
  | { action: "continue" }
  | { action: "skip" };

export function evaluateReviewRequestedGate(params: {
  payload: Record<string, unknown>;
  appSlug: string;
  baseLog: Record<string, unknown>;
  logger: ReviewRequestedLogger;
}): ReviewRequestedGateDecision {
  const requestedReviewer =
    "requested_reviewer" in params.payload
      ? params.payload.requested_reviewer
      : undefined;
  const requestedTeam =
    "requested_team" in params.payload
      ? params.payload.requested_team
      : undefined;
  const requestedReviewerLogin =
    isObjectWithStringProperty(requestedReviewer, "login")
      ? requestedReviewer.login
      : undefined;
  const requestedTeamName =
    isObjectWithStringProperty(requestedTeam, "name")
      ? requestedTeam.name
      : undefined;
  const requestedTeamSlug =
    isObjectWithStringProperty(requestedTeam, "slug")
      ? requestedTeam.slug
      : undefined;
  const normalizedAppSlug = normalizeReviewerLogin(params.appSlug);

  if (requestedReviewerLogin) {
    const normalizedRequestedReviewer = normalizeReviewerLogin(requestedReviewerLogin);
    if (normalizedRequestedReviewer !== normalizedAppSlug) {
      params.logger.info(
        {
          ...params.baseLog,
          gate: "review_requested_reviewer",
          gateResult: "skipped",
          skipReason: "non-kodiai-reviewer",
          requestedReviewer: requestedReviewerLogin,
          normalizedRequestedReviewer,
          normalizedAppSlug,
          requestedTeam: requestedTeamName ?? null,
        },
        "Skipping review_requested event for non-kodiai reviewer",
      );
      return { action: "skip" };
    }

    params.logger.info(
      {
        ...params.baseLog,
        gate: "review_requested_reviewer",
        gateResult: "accepted",
        requestedReviewer: requestedReviewerLogin,
        normalizedRequestedReviewer,
        normalizedAppSlug,
      },
      "Accepted review_requested event for kodiai reviewer",
    );
    return { action: "continue" };
  }

  if (requestedTeamName || requestedTeamSlug) {
    params.logger.info(
      {
        ...params.baseLog,
        gate: "review_requested_reviewer",
        gateResult: "skipped",
        skipReason: "team-only-request",
        requestedReviewer: null,
        requestedTeam: requestedTeamName ?? null,
        requestedTeamSlug: requestedTeamSlug ?? null,
      },
      "Skipping review_requested event because only a team was requested",
    );
    return { action: "skip" };
  }

  params.logger.warn(
    {
      ...params.baseLog,
      gate: "review_requested_reviewer",
      gateResult: "skipped",
      skipReason: "missing-or-malformed-reviewer-payload",
      hasRequestedReviewerField: "requested_reviewer" in params.payload,
      hasRequestedTeamField: "requested_team" in params.payload,
    },
    "Skipping review_requested event due to missing reviewer payload",
  );
  return { action: "skip" };
}

function isObjectWithStringProperty<T extends string>(
  value: unknown,
  property: T,
): value is Record<T, string> {
  return (
    typeof value === "object"
    && value !== null
    && typeof (value as Record<T, unknown>)[property] === "string"
  );
}
