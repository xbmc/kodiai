import type { Logger } from "pino";
import type { Octokit } from "@octokit/rest";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import { buildReviewOutputMarker } from "../review-orchestration/review-idempotency.ts";
import { upsertCanonicalReviewSurface } from "../review-orchestration/review-canonical-surface.ts";
import type { ReviewCandidatePublicationRuntimeResult } from "../review-orchestration/review-candidate-publication-runtime.ts";
import type { ReviewFindingLifecyclePublicProjection } from "../review-lifecycle/finding-lifecycle.ts";

type SeverityCounts = {
  critical: number;
  major: number;
  medium: number;
  minor: number;
};

export type BlockedReviewFindingsNotice = {
  body: string;
  findingCount: number;
  severityCounts: SeverityCounts;
  reasons: string[];
};

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function formatSeveritySummary(counts: SeverityCounts): string {
  return `${counts.critical} critical, ${counts.major} major, ${counts.medium} medium, ${counts.minor} minor`;
}

function boundedReasons(reasons: readonly string[]): string[] {
  return reasons
    .map((reason) => reason.trim())
    .filter((reason) => /^[a-z0-9][a-z0-9-]{0,63}$/i.test(reason))
    .slice(0, 6);
}

export function resolveBlockedReviewFindingsNotice(params: {
  reviewOutputKey: string;
  reviewDetailsBlock: string | null;
  candidatePublicationRuntime: ReviewCandidatePublicationRuntimeResult;
  findingLifecycle: ReviewFindingLifecyclePublicProjection | null;
}): BlockedReviewFindingsNotice | null {
  const severity = params.findingLifecycle?.counts.severity;
  const severityCounts: SeverityCounts = {
    critical: readCount(severity?.critical),
    major: readCount(severity?.major),
    medium: readCount(severity?.medium),
    minor: readCount(severity?.minor),
  };
  const findingCount = severityCounts.critical + severityCounts.major + severityCounts.medium + severityCounts.minor;
  if (findingCount === 0) return null;

  const runtime = params.candidatePublicationRuntime;
  const blockedCount = runtime.counts.fixEligibilityBlocked + runtime.counts.candidateBlocked;
  const publishedFindingOutputCount = runtime.counts.candidatePublished + runtime.counts.directPublished;
  const hasBlockedPublication =
    runtime.mode === "blocked"
    || blockedCount > 0
    || runtime.reasons.includes("fix-eligibility-blocked")
    || runtime.reasons.includes("candidate-publisher-blocked");
  if (!hasBlockedPublication && publishedFindingOutputCount > 0) return null;

  const reasons = boundedReasons(
    runtime.reasons.length > 0
      ? runtime.reasons
      : ["unpublished-review-findings"],
  );
  const reviewDetailsBlock = params.reviewDetailsBlock
    ?.replace(buildReviewOutputMarker(params.reviewOutputKey), "")
    .trim();
  const issueLine = `Kodiai found ${findingCount} unpublished ${pluralize(findingCount, "finding")} that ${findingCount === 1 ? "requires" : "require"} human review.`;
  const body = [
    "Decision: NOT APPROVED",
    "",
    "Issues:",
    `- ${issueLine}`,
    `- Bounded severity summary: ${formatSeveritySummary(severityCounts)}.`,
    `- Review output did not publish these findings inline${reasons.length > 0 ? `: ${reasons.join(", ")}` : "."}`,
    "- Raw finding text was kept private; see Review Details for bounded counts and publication diagnostics.",
    ...(reviewDetailsBlock ? ["", reviewDetailsBlock] : []),
    "",
    buildReviewOutputMarker(params.reviewOutputKey),
  ].join("\n");

  return {
    body,
    findingCount,
    severityCounts,
    reasons,
  };
}

export async function publishBlockedReviewFindingsNotice(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  body: string;
  botHandles: string[];
  logger: Pick<Logger, "info">;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
}): Promise<boolean> {
  if (!params.canPublishVisibleOutput("blocked findings notice")) {
    return false;
  }

  params.setReviewWorkPhase("publish");
  await upsertCanonicalReviewSurface({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    preferredKind: "issue_comment",
    body: params.body,
    botHandles: params.botHandles,
    recheckCanPublish: () => params.canPublishVisibleOutput("blocked findings notice"),
  });
  params.logger.info(
    {
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      gate: "blocked-findings-notice",
      gateResult: "published",
    },
    "Published blocked review findings notice",
  );
  return true;
}

export async function publishBlockedReviewFindingsNoticeForRuntime(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  reviewDetailsBlock: string | null;
  candidatePublicationRuntime: ReviewCandidatePublicationRuntimeResult;
  findingLifecycle: ReviewFindingLifecyclePublicProjection | null;
  processedFindingCount: number;
  handlerPublishedReviewOutput: boolean;
  botHandles: string[];
  logger: Pick<Logger, "info">;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
}): Promise<
  | { published: false; suppressCleanApprovalReason?: string }
  | { published: true; suppressCleanApprovalReason: string; reviewPublishResolution: string }
> {
  const publishedFindingOutputCount =
    params.candidatePublicationRuntime.counts.candidatePublished
    + params.candidatePublicationRuntime.counts.directPublished
    + (params.handlerPublishedReviewOutput ? 1 : 0);
  const fallbackSuppressCleanApprovalReason = params.processedFindingCount > 0 && publishedFindingOutputCount > 0
    ? "published-findings-present"
    : undefined;
  const notice = resolveBlockedReviewFindingsNotice(params);
  if (!notice) return { published: false, suppressCleanApprovalReason: fallbackSuppressCleanApprovalReason };

  const published = await publishBlockedReviewFindingsNotice({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    body: notice.body,
    botHandles: params.botHandles,
    logger: params.logger,
    canPublishVisibleOutput: params.canPublishVisibleOutput,
    setReviewWorkPhase: params.setReviewWorkPhase,
  });
  if (!published) return { published: false, suppressCleanApprovalReason: fallbackSuppressCleanApprovalReason };

  return {
    published: true,
    suppressCleanApprovalReason: "blocked-candidate-findings",
    reviewPublishResolution: "blocked-findings-notice",
  };
}
