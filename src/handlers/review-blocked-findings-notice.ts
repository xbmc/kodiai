import type { Logger } from "pino";
import type { Octokit } from "@octokit/rest";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import { buildReviewOutputMarker } from "../review-orchestration/review-idempotency.ts";
import {
  reconcileSupersededCanonicalSurface,
  upsertCanonicalReviewSurface,
} from "../review-orchestration/review-canonical-surface.ts";
import type { ReviewCandidatePublicationRuntimeResult } from "../review-orchestration/review-candidate-publication-runtime.ts";
import type { ReviewFindingLifecyclePublicProjection } from "../review-lifecycle/finding-lifecycle.ts";
import { sanitizeContent, scanOutgoingForSecrets } from "../lib/sanitizer.ts";
import type { ProcessedFinding } from "./review-processed-finding.ts";

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

const MAX_VISIBLE_FINDINGS = 5;
const MAX_VISIBLE_TITLE_LENGTH = 120;
const MAX_VISIBLE_EXCERPT_LENGTH = 240;

function formatVisibleFindingLines(runtime: ReviewCandidatePublicationRuntimeResult): string[] {
  if (!hasSafeDetailsProjection(runtime)) return [];

  return runtime.detailsOnlyFindings
    .slice(0, MAX_VISIBLE_FINDINGS)
    .flatMap((finding) => {
      const path = sanitizePath(finding.location.path);
      const line = readPositiveInteger(finding.location.line);
      const title = sanitizeVisibleText(finding.title, MAX_VISIBLE_TITLE_LENGTH);
      if (!path || !line || !title) return [];
      const excerpt = sanitizeVisibleText(finding.excerpt, MAX_VISIBLE_EXCERPT_LENGTH);
      return [
        `- **${finding.severity.toUpperCase()}** \`${path}:${line}\` — ${title}`,
        ...(excerpt ? [`  ${excerpt}`] : []),
      ];
    });
}

function formatProcessedFindingLines(findings: readonly ProcessedFinding[]): string[] {
  return findings
    .filter((finding) => finding.suppressed !== true)
    .slice(0, MAX_VISIBLE_FINDINGS)
    .flatMap((finding) => {
      const path = sanitizePath(finding.filePath);
      const line = readPositiveInteger(finding.startLine);
      const title = sanitizeVisibleText(finding.title, MAX_VISIBLE_TITLE_LENGTH);
      if (!path || !line || !title) return [];
      return [`- **${String(finding.severity).toUpperCase()}** \`${path}:${line}\` — ${title}`];
    });
}

function hasSafeDetailsProjection(runtime: ReviewCandidatePublicationRuntimeResult): boolean {
  const redaction = runtime.movedToDetails?.redaction;
  return Boolean(
    redaction
    && redaction.rawCandidatePayloadsIncluded === false
    && redaction.rawPromptsIncluded === false
    && redaction.rawModelOutputIncluded === false
    && redaction.diffsIncluded === false
    && redaction.replacementTextIncluded === false
    && redaction.githubResponsePayloadsIncluded === false
    && redaction.secretLikeValuesIncluded === false
    && redaction.bounded === true,
  );
}

function sanitizePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\\/g, "/").replace(/^b\//, "").slice(0, 160);
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || /^[a-zA-Z]:\//.test(normalized)) {
    return null;
  }
  return normalized.replace(/`/g, "");
}

function sanitizeVisibleText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const normalized = sanitizeContent(value)
    .replace(/```suggestion[\s\S]*?```/gi, "[automatic fix omitted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || scanOutgoingForSecrets(normalized).blocked) return null;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.trunc(value)
    : null;
}

export function willBlockedReviewFindingsNoticePublish(params: {
  candidatePublicationRuntime: ReviewCandidatePublicationRuntimeResult;
  findingLifecycle: ReviewFindingLifecyclePublicProjection | null;
  handlerPublishedReviewOutput: boolean;
}): boolean {
  return resolveBlockedReviewFindingsNotice({
    reviewOutputKey: "",
    reviewDetailsBlock: null,
    candidatePublicationRuntime: params.candidatePublicationRuntime,
    findingLifecycle: params.findingLifecycle,
    handlerPublishedReviewOutput: params.handlerPublishedReviewOutput,
  }) !== null;
}

export function resolveBlockedReviewFindingsNotice(params: {
  reviewOutputKey: string;
  reviewDetailsBlock: string | null;
  candidatePublicationRuntime: ReviewCandidatePublicationRuntimeResult;
  findingLifecycle: ReviewFindingLifecyclePublicProjection | null;
  visibleFindings?: readonly ProcessedFinding[];
  handlerPublishedReviewOutput: boolean;
}): BlockedReviewFindingsNotice | null {
  // The handler's own primary output already published a full verdict (APPROVE or
  // NOT APPROVED) under the same canonical marker; a secondary blocked-candidate notice
  // must never overwrite that already-visible decision.
  if (params.handlerPublishedReviewOutput) return null;

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
  const visibleFindingLines = formatVisibleFindingLines(runtime);
  const fallbackFindingLines = visibleFindingLines.length > 0
    ? visibleFindingLines
    : formatProcessedFindingLines(params.visibleFindings ?? []);
  const omittedVisibleFindings = Math.max(0, findingCount - fallbackFindingLines.filter((line) => line.startsWith("- **")).length);
  const body = [
    "Decision: NOT APPROVED",
    "",
    "Issues:",
    ...(fallbackFindingLines.length > 0
      ? [
          ...fallbackFindingLines,
          ...(omittedVisibleFindings > 0
            ? [`- ...and ${omittedVisibleFindings} additional ${pluralize(omittedVisibleFindings, "finding")} omitted from this bounded summary.`]
            : []),
          "",
          "The findings need attention even though Kodiai could not produce safe automatic patches for them.",
        ]
      : [
          `- ${issueLine}`,
          `- Bounded severity summary: ${formatSeveritySummary(severityCounts)}.`,
          `- Review output did not publish these findings inline${reasons.length > 0 ? `: ${reasons.join(", ")}` : "."}`,
          "- Raw finding text was kept private; see Review Details for bounded counts and publication diagnostics.",
        ]),
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
  logger: Pick<Logger, "info" | "warn">;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
}): Promise<boolean> {
  if (!params.canPublishVisibleOutput("blocked findings notice")) {
    return false;
  }

  params.setReviewWorkPhase("publish");
  const canonicalSurface = await upsertCanonicalReviewSurface({
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
  if (!canonicalSurface) {
    params.logger.info(
      {
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        gate: "blocked-findings-notice",
        gateResult: "skipped",
        skipReason: "publish-rights-lost-during-write",
      },
      "Skipped blocked review findings notice because publish rights were superseded mid-write",
    );
    return false;
  }
  await reconcileSupersededCanonicalSurface({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    newSurfaceKind: "issue_comment",
    botHandles: params.botHandles,
    logger: params.logger,
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
  visibleFindings?: readonly ProcessedFinding[];
  processedFindingCount: number;
  handlerPublishedReviewOutput: boolean;
  botHandles: string[];
  logger: Pick<Logger, "info" | "warn">;
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
