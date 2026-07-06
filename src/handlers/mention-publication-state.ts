import { classifyError } from "../lib/errors.ts";
import type { WriteRateLimitStore } from "../lib/mention-state-stores.ts";
import type { Result } from "../lib/result.ts";
import type { ExplicitMentionReviewPublishSkipReason } from "../review-orchestration/explicit-mention-review-publish.ts";

export type MentionPublishResolution =
  | "none"
  | "executor"
  | "approval-bridge"
  | "comment-approval"
  | "idempotency-skip"
  | "duplicate-suppressed"
  | "publish-failure-fallback"
  | "publish-failure-comment-failed"
  | "error-fallback"
  | "error-comment-failed"
  | "turn-limit-fallback"
  | "turn-limit-fallback-failed"
  | "failure-fallback"
  | "failure-fallback-failed";

export type MentionErrorDelivery =
  | "review-thread-reply"
  | "error-comment-created"
  | "error-comment-updated"
  | "error-comment-failed";

export type MentionErrorPostResult = Result<MentionErrorDelivery>;

export function mentionErrorDeliveryFromResult(result: MentionErrorPostResult): MentionErrorDelivery {
  return result.ok ? result.value : "error-comment-failed";
}

export type MentionExecutionFailureSubtype = "usage_limit";

export function isExpectedTurnLimitMentionOutcome(params: {
  conclusion: string;
  stopReason?: string;
  failureSubtype?: string;
}): boolean {
  return params.conclusion === "failure"
    && (params.stopReason === "max_turns" || params.failureSubtype === "error_max_turns");
}

export function mapTurnLimitFallbackDelivery(delivery: MentionErrorDelivery | null): string | null {
  switch (delivery) {
    case "error-comment-created":
      return "turn-limit-comment-created";
    case "error-comment-updated":
      return "turn-limit-comment-updated";
    case "error-comment-failed":
      return "turn-limit-comment-undelivered";
    default:
      return delivery;
  }
}

export function cleanTurnLimitMentionPublishResolution(resolution: MentionPublishResolution): string {
  return resolution === "turn-limit-fallback-failed"
    ? "turn-limit-fallback-undelivered"
    : resolution;
}

export type CombinedReviewAndFormatMentionFormatterResult = {
  status: string;
  commandStatus?: string;
  publisherStatus?: string;
  suggestions: number;
  skipped: number;
  capped: number;
  posted?: number;
  publisherSkipped?: number;
  publisherFailed?: boolean;
  partialFailure?: boolean;
  reviewOutputKey?: string;
};

export function buildFormatOnlyMentionLogFields(params: {
  mention: {
    surface: string;
    owner: string;
    repo: string;
    issueNumber: number;
    prNumber?: number;
  };
  deliveryId: string;
  reviewOutputAction?: string;
  formatterResult: CombinedReviewAndFormatMentionFormatterResult;
  visibleReplyPosted: boolean;
  visibleReplyFailed: boolean;
}): Record<string, unknown> {
  return {
    surface: params.mention.surface,
    owner: params.mention.owner,
    repo: params.mention.repo,
    issueNumber: params.mention.issueNumber,
    prNumber: params.mention.prNumber,
    deliveryId: params.deliveryId,
    reviewOutputKey: params.formatterResult.reviewOutputKey,
    reviewOutputAction: params.reviewOutputAction ?? "mention-format-suggestions",
    formatterSuggestionRequest: true,
    formatterMode: "format-only",
    formatterStatus: params.formatterResult.status,
    commandStatus: params.formatterResult.commandStatus,
    publisherStatus: params.formatterResult.publisherStatus,
    suggestions: params.formatterResult.suggestions,
    skipped: params.formatterResult.skipped,
    capped: params.formatterResult.capped,
    posted: params.formatterResult.posted,
    publisherSkipped: params.formatterResult.publisherSkipped,
    publisherFailed: params.formatterResult.publisherFailed,
    partialFailure: params.formatterResult.partialFailure ?? false,
    visibleReplyPosted: params.visibleReplyPosted,
    visibleReplyFailed: params.visibleReplyFailed,
  };
}

export function buildCombinedReviewAndFormatMentionLogFields(params: {
  mention: {
    surface: string;
    owner: string;
    repo: string;
    issueNumber: number;
    prNumber?: number;
  };
  deliveryId: string;
  reviewOutputAction?: string;
  result: {
    conclusion: string;
    stopReason?: string;
    failureSubtype?: string;
  };
  publishResolution: MentionPublishResolution;
  publishFailureCategory: unknown;
  publishFallbackDelivery: MentionErrorDelivery | null;
  formatterResult: CombinedReviewAndFormatMentionFormatterResult;
  visibleReplyPosted: boolean;
  visibleReplyFailed: boolean;
}): Record<string, unknown> {
  const expectedTurnLimitOutcome = isExpectedTurnLimitMentionOutcome({
    conclusion: params.result.conclusion,
    stopReason: params.result.stopReason,
    failureSubtype: params.result.failureSubtype,
  });
  const reviewPartialFailure =
    params.result.conclusion !== "success"
    || params.publishResolution === "publish-failure-fallback"
    || params.publishResolution === "publish-failure-comment-failed"
    || params.publishFailureCategory !== null;
  const formatterPartialFailure =
    params.formatterResult.partialFailure === true
    || params.formatterResult.status === "failed"
    || params.formatterResult.status === "blocked"
    || params.formatterResult.status === "pr-diff-unavailable"
    || params.formatterResult.status === "setup-needed";
  const expectedBoundedCleanFormatter =
    expectedTurnLimitOutcome && !formatterPartialFailure && !params.visibleReplyFailed;

  return {
    surface: params.mention.surface,
    owner: params.mention.owner,
    repo: params.mention.repo,
    issueNumber: params.mention.issueNumber,
    prNumber: params.mention.prNumber,
    deliveryId: params.deliveryId,
    reviewOutputKey: params.formatterResult.reviewOutputKey,
    reviewOutputAction: params.reviewOutputAction ?? "mention-format-suggestions",
    formatterSuggestionRequest: true,
    formatterMode: "review-and-format",
    reviewConclusion: expectedTurnLimitOutcome ? "expected_bounded" : params.result.conclusion,
    ...(expectedTurnLimitOutcome ? { boundedOutcomeReason: "max_turns" } : {}),
    publishResolution: expectedTurnLimitOutcome
      ? cleanTurnLimitMentionPublishResolution(params.publishResolution)
      : params.publishResolution,
    ...(expectedBoundedCleanFormatter ? {} : { publishFailureCategory: params.publishFailureCategory }),
    publishFallbackDelivery: expectedTurnLimitOutcome
      ? mapTurnLimitFallbackDelivery(params.publishFallbackDelivery)
      : params.publishFallbackDelivery,
    formatterStatus: params.formatterResult.status,
    commandStatus: params.formatterResult.commandStatus,
    publisherStatus: params.formatterResult.publisherStatus,
    suggestions: params.formatterResult.suggestions,
    skipped: params.formatterResult.skipped,
    capped: params.formatterResult.capped,
    posted: params.formatterResult.posted,
    publisherSkipped: params.formatterResult.publisherSkipped,
    ...(expectedBoundedCleanFormatter ? {} : { publisherFailed: params.formatterResult.publisherFailed }),
    ...(expectedBoundedCleanFormatter ? {} : { formatterPartialFailure }),
    formatterVisibleReplyPosted: params.visibleReplyPosted,
    ...(expectedBoundedCleanFormatter ? {} : { formatterVisibleReplyFailed: params.visibleReplyFailed }),
    ...(expectedBoundedCleanFormatter
      ? { combinedOutcome: "expected_bounded" }
      : { combinedPartialFailure: reviewPartialFailure || formatterPartialFailure || params.visibleReplyFailed }),
  };
}

export function buildCombinedReviewAndFormatThrownMentionLogFields(params: {
  mention: {
    surface: string;
    owner: string;
    repo: string;
    issueNumber: number;
    prNumber?: number;
  };
  deliveryId: string;
  reviewOutputAction?: string;
  formatterResult: CombinedReviewAndFormatMentionFormatterResult;
  visibleReplyPosted: boolean;
  visibleReplyFailed: boolean;
}): Record<string, unknown> {
  return {
    surface: params.mention.surface,
    owner: params.mention.owner,
    repo: params.mention.repo,
    issueNumber: params.mention.issueNumber,
    prNumber: params.mention.prNumber,
    deliveryId: params.deliveryId,
    reviewOutputKey: params.formatterResult.reviewOutputKey,
    reviewOutputAction: params.reviewOutputAction ?? "mention-format-suggestions",
    formatterSuggestionRequest: true,
    formatterMode: "review-and-format",
    reviewConclusion: "threw",
    formatterStatus: params.formatterResult.status,
    commandStatus: params.formatterResult.commandStatus,
    publisherStatus: params.formatterResult.publisherStatus,
    suggestions: params.formatterResult.suggestions,
    skipped: params.formatterResult.skipped,
    capped: params.formatterResult.capped,
    posted: params.formatterResult.posted,
    publisherSkipped: params.formatterResult.publisherSkipped,
    publisherFailed: params.formatterResult.publisherFailed,
    formatterPartialFailure: params.formatterResult.partialFailure ?? false,
    formatterVisibleReplyPosted: params.visibleReplyPosted,
    formatterVisibleReplyFailed: params.visibleReplyFailed,
    combinedPartialFailure: true,
  };
}

export function describeExplicitReviewPublishSkipReason(reason: ExplicitMentionReviewPublishSkipReason | undefined): string {
  switch (reason) {
    case "missing-inspection-evidence":
      return "the run did not provide the required repo-inspection evidence";
    case "missing-review-output-key":
      return "the run was missing its review publication key";
    case "execution-not-success":
      return "the review executor did not finish successfully";
    case "output-already-published":
      return "review output was already published for this request";
    case "result-text-findings":
      return "the run produced findings that were not safely publishable";
    case "not-eligible":
      return "the run did not satisfy the explicit-review publication gate";
    default:
      return "the run did not satisfy the explicit-review publication gate";
  }
}

export function buildExplicitReviewNoOutputFallbackLines(
  reason: ExplicitMentionReviewPublishSkipReason | undefined,
): string[] {
  return [
    "I completed the review run, but couldn't publish a trustworthy review result from it.",
    "",
    `Reason: ${describeExplicitReviewPublishSkipReason(reason)}.`,
    "No code findings were published for this request.",
  ];
}

export function classifyMentionExecutionFailureSubtype(
  errorMessage: string | undefined,
): MentionExecutionFailureSubtype | undefined {
  if (errorMessage === undefined) {
    return undefined;
  }
  return classifyError(new Error(errorMessage), false) === "usage_limit" ? "usage_limit" : undefined;
}

export function buildMentionExecutionCompletedLogFields(params: {
  surface: string;
  issueNumber: number;
  result: {
    conclusion: string;
    published: boolean;
    costUsd?: number;
    numTurns?: number;
    durationMs?: number;
    sessionId?: string;
    stopReason?: string;
    usedRepoInspectionTools?: boolean;
    toolUseNames?: string[];
  };
  mentionFailureSubtype?: string;
  mentionExecutionErrorCategory?: unknown;
  mentionOutputPublished: boolean;
  publishResolution: MentionPublishResolution;
  publishFailureCategory: unknown;
  publishFallbackDelivery: MentionErrorDelivery | null;
  writeEnabled: boolean;
  mentionDerivedContextCacheStatus: unknown;
  mentionDerivedContextCacheReason?: string | null;
  explicitReviewRequest: boolean;
  reviewOutputKey?: string;
}): Record<string, unknown> {
  const expectedTurnLimitOutcome = isExpectedTurnLimitMentionOutcome({
    conclusion: params.result.conclusion,
    stopReason: params.result.stopReason,
    failureSubtype: params.mentionFailureSubtype,
  });

  return {
    surface: params.surface,
    issueNumber: params.issueNumber,
    conclusion: expectedTurnLimitOutcome ? "expected_bounded" : params.result.conclusion,
    ...(expectedTurnLimitOutcome
      ? { boundedOutcomeReason: "max_turns" }
      : { failureSubtype: params.mentionFailureSubtype }),
    published: params.mentionOutputPublished,
    executorPublished: params.result.published,
    publishResolution: expectedTurnLimitOutcome
      ? cleanTurnLimitMentionPublishResolution(params.publishResolution)
      : params.publishResolution,
    ...(expectedTurnLimitOutcome ? {} : { publishFailureCategory: params.publishFailureCategory }),
    publishFallbackDelivery: expectedTurnLimitOutcome
      ? mapTurnLimitFallbackDelivery(params.publishFallbackDelivery)
      : params.publishFallbackDelivery,
    writeEnabled: params.writeEnabled,
    costUsd: params.result.costUsd,
    numTurns: params.result.numTurns,
    durationMs: params.result.durationMs,
    sessionId: params.result.sessionId,
    stopReason: params.result.stopReason,
    ...(expectedTurnLimitOutcome ? {} : { errorCategory: params.mentionExecutionErrorCategory }),
    usedRepoInspectionTools: params.result.usedRepoInspectionTools ?? false,
    toolUseNames: params.result.toolUseNames ?? [],
    mentionDerivedContextCacheStatus: params.mentionDerivedContextCacheStatus,
    ...(params.mentionDerivedContextCacheReason
      ? { mentionDerivedContextCacheReason: params.mentionDerivedContextCacheReason }
      : {}),
    ...(params.explicitReviewRequest
      ? {
        explicitReviewRequest: true,
        taskType: "review.full",
        lane: "interactive-review",
      }
      : {}),
    ...(params.reviewOutputKey ? { reviewOutputKey: params.reviewOutputKey } : {}),
  };
}

export function createMentionExecutionCompletedLogger(params: {
  logger: {
    info(fields: Record<string, unknown>, message?: string): void;
  };
  getState: () => Parameters<typeof buildMentionExecutionCompletedLogFields>[0];
}): () => void {
  return () => {
    params.logger.info(
      buildMentionExecutionCompletedLogFields(params.getState()),
      "Mention execution completed",
    );
  };
}

export function recordMentionWriteRateLimitSuccess(params: {
  store: WriteRateLimitStore;
  installationId: number;
  owner: string;
  repo: string;
}): void {
  params.store.recordWrite(`${params.installationId}:${params.owner}/${params.repo}`);
}
