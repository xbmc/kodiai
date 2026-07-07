import type {
  PullRequestOpenedEvent,
  PullRequestReadyForReviewEvent,
  PullRequestReviewRequestedEvent,
  PullRequestSynchronizeEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import {
  buildReviewFamilyKey,
  type ReviewWorkCoordinator,
} from "../jobs/review-work-coordinator.ts";
import type { WebhookEvent } from "../webhook/types.ts";
import { buildReviewOutputKey } from "../review-orchestration/review-idempotency.ts";
import { createReviewWorkRuntime } from "./review-work-runtime.ts";
import { evaluateNoReviewSkipGate } from "./review-no-review-skip.ts";
import { evaluateReviewRequestedGate } from "./review-requested-gate.ts";
import { resolveReviewClonePlan } from "./review-clone-plan.ts";
import { resolveReviewDraftToneContext } from "./review-draft-tone.ts";

export type ReviewWebhookPayload =
  | PullRequestOpenedEvent
  | PullRequestReadyForReviewEvent
  | PullRequestReviewRequestedEvent
  | PullRequestSynchronizeEvent;

export async function resolveReviewEventRuntime(params: {
  event: WebhookEvent;
  payload: ReviewWebhookPayload;
  githubApp: GitHubApp;
  reviewWorkCoordinator: ReviewWorkCoordinator;
  logger: Logger;
}) {
  const { event, payload, githubApp, reviewWorkCoordinator, logger } = params;
  const pr = payload.pull_request;
  const action = payload.action;
  const apiOwner = payload.repository.owner.login;
  const apiRepo = payload.repository.name;
  const baseLog = {
    deliveryId: event.id,
    installationId: event.installationId,
    action,
    prNumber: pr.number,
    owner: apiOwner,
    repo: apiRepo,
  };
  const reviewOutputKey = buildReviewOutputKey({
    installationId: event.installationId,
    owner: apiOwner,
    repo: apiRepo,
    prNumber: pr.number,
    action,
    deliveryId: event.id,
    headSha: pr.head.sha ?? "unknown-head-sha",
  });

  const { isDraft } = resolveReviewDraftToneContext({
    action,
    prDraft: Boolean(pr.draft),
    baseLog,
    logger,
  });

  const noReviewSkipGate = await evaluateNoReviewSkipGate({
    prTitle: pr.title,
    owner: apiOwner,
    repo: apiRepo,
    prNumber: pr.number,
    baseLog,
    botHandles: [githubApp.getAppSlug(), "claude"],
    getOctokit: () => githubApp.getInstallationOctokit(event.installationId),
    logger,
  });
  if (noReviewSkipGate.action === "skip") {
    return { action: "skip" as const };
  }

  if (action === "review_requested") {
    const reviewRequestedGate = evaluateReviewRequestedGate({
      payload: payload as unknown as Record<string, unknown>,
      appSlug: githubApp.getAppSlug(),
      baseLog,
      logger,
    });
    if (reviewRequestedGate.action === "skip") {
      return { action: "skip" as const };
    }
  }

  const reviewClonePlan = resolveReviewClonePlan({
    apiOwner,
    apiRepo,
    repositoryFullName: payload.repository.full_name,
    baseRef: pr.base.ref,
    headRef: pr.head.ref,
    headRepo: pr.head.repo,
  });
  const {
    cloneOwner,
    cloneRepo,
    cloneRef,
    isFork,
    isDeletedFork,
    usesPrRef,
    workspaceStrategy,
  } = reviewClonePlan;

  logger.info(
    {
      prNumber: pr.number,
      apiOwner,
      apiRepo,
      cloneOwner,
      cloneRepo,
      cloneRef,
      isFork,
      isDeletedFork,
      usesPrRef,
      workspaceStrategy,
      action,
      deliveryId: event.id,
      installationId: event.installationId,
    },
    "Processing PR review",
  );

  logger.info(
    { ...baseLog, gate: "enqueue", gateResult: "started" },
    "Review enqueue started",
  );

  const reviewFamilyKey = buildReviewFamilyKey(apiOwner, apiRepo, pr.number);
  const reviewWorkAttempt = reviewWorkCoordinator.claim({
    familyKey: reviewFamilyKey,
    source: "automatic-review",
    lane: "review",
    deliveryId: event.id,
    phase: "claimed",
  });
  const reviewWorkRuntime = createReviewWorkRuntime({
    attempt: reviewWorkAttempt,
    coordinator: reviewWorkCoordinator,
  });

  return {
    action: "continue" as const,
    pr,
    eventAction: action,
    baseLog,
    reviewOutputKey,
    isDraft,
    apiOwner,
    apiRepo,
    cloneOwner,
    cloneRepo,
    cloneRef,
    usesPrRef,
    workspaceStrategy,
    reviewFamilyKey,
    reviewWorkAttempt,
    reviewWorkRuntime,
  };
}
