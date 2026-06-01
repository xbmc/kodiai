/**
 * Final assembly for the Review Details block.
 */

import {
  buildKeywordParsingSection,
  DEFAULT_EMPTY_INTENT,
  type ParsedPRIntent,
} from "../lib/pr-intent-parser.ts";
import type { ResolvedReviewProfile } from "../lib/auto-profile.ts";
import type { ContributorExperienceReviewDetailsProjection } from "../contributor/experience-contract.ts";
import { buildStructuralImpactSection } from "./structural-impact-formatter.ts";
import { summarizeStructuralImpactDegradation } from "../structural-impact/degradation.ts";
import type { StructuralImpactPayload } from "../structural-impact/types.ts";
import type { ReviewBoundednessContract } from "./review-boundedness.ts";
import type { ReviewFirstPassPayload } from "./review-first-pass.ts";
import type { ReviewPlanDetailsSummary } from "../review-orchestration/review-plan.ts";
import type { ReviewReducerDetailsSummary } from "../review-orchestration/review-reducer.ts";
import {
  formatReviewPlanDetailsLine,
  formatReviewReducerDetailsLine,
} from "./review-details-plan-formatting.ts";
import type { ReviewCandidateFindingDetailsSummary } from "../review-orchestration/review-candidate-finding.ts";
import type { ReviewCandidatePublicationRuntimeDetailsSummary } from "../review-orchestration/review-candidate-publication-runtime.ts";
import {
  formatCandidatePublicationBridgeLine,
  formatCandidateVerificationPublicationEvidenceLine,
  formatReviewCandidateFindingDetailsLine,
  formatReviewCandidatePublicationDetailsLine,
  type CandidatePublicationBridgeReviewDetails,
  type CandidateVerificationPublicationEvidenceReviewDetails,
} from "./review-details-candidate-formatting.ts";
import type { ReviewFindingLifecyclePublicProjection } from "../review-lifecycle/finding-lifecycle.ts";
import type { ValidationTruthProjection } from "../review-lifecycle/validation-truth.ts";
import {
  formatReviewFindingLifecycleDetailsLine,
  formatReviewValidationTruthDetailsLine,
} from "./review-details-validation-formatting.ts";
import {
  describeReviewFirstPass,
  type TimeoutBudgetDetails,
} from "./review-details-first-pass-formatting.ts";
import {
  formatReviewDetailsPhaseTimingSummary,
  type ReviewDetailsPhaseTimingSummary,
} from "./review-details-phase-formatting.ts";

export type { TimeoutBudgetDetails } from "./review-details-first-pass-formatting.ts";
export {
  buildReviewFirstPassPublicSummary,
  describeReviewFirstPass,
} from "./review-details-first-pass-formatting.ts";
export type { ReviewDetailsPhaseTimingSummary } from "./review-details-phase-formatting.ts";
export type {
  CandidatePublicationBridgeReviewDetails,
  CandidateVerificationPublicationEvidenceReviewDetails,
} from "./review-details-candidate-formatting.ts";

export type TimeoutReviewDetailsProgress = {
  analyzedFiles: number;
  totalFiles: number;
  findingCount: number;
  retryState: string;
};

export type ReviewDetailsLineCountSource = "local-diff" | "github-pr-api-fallback";

export type ReviewRetryFailureClassification = {
  category: "retry-infra-failure" | "retry-execution-failure";
  reason: "workspace-prep-terminated" | "unknown";
};

export function resolveReviewDetailsLineCounts(params: {
  diffLinesAdded: number;
  diffLinesRemoved: number;
  prApiLinesAdded?: number;
  prApiLinesRemoved?: number;
}): {
  linesAdded: number;
  linesRemoved: number;
  source: ReviewDetailsLineCountSource;
} {
  const diffLinesAdded = Math.max(0, params.diffLinesAdded);
  const diffLinesRemoved = Math.max(0, params.diffLinesRemoved);
  const prApiLinesAdded = Math.max(0, params.prApiLinesAdded ?? 0);
  const prApiLinesRemoved = Math.max(0, params.prApiLinesRemoved ?? 0);

  if (diffLinesAdded + diffLinesRemoved === 0 && prApiLinesAdded + prApiLinesRemoved > 0) {
    return {
      linesAdded: prApiLinesAdded,
      linesRemoved: prApiLinesRemoved,
      source: "github-pr-api-fallback",
    };
  }

  return {
    linesAdded: diffLinesAdded,
    linesRemoved: diffLinesRemoved,
    source: "local-diff",
  };
}

export function classifyRetryFailure(err: unknown): ReviewRetryFailureClassification {
  const exitCode = typeof err === "object" && err !== null
    ? (err as { exitCode?: unknown }).exitCode
    : undefined;
  const message = err instanceof Error ? err.message : String(err);

  if (exitCode === 143 || exitCode === "143" || /exit code 143|sigterm/i.test(message)) {
    return { category: "retry-infra-failure", reason: "workspace-prep-terminated" };
  }

  return { category: "retry-execution-failure", reason: "unknown" };
}

export function buildReviewDetailsMarker(reviewOutputKey: string): string {
  return `<!-- kodiai:review-details:${reviewOutputKey} -->`;
}

export function formatReviewDetailsSummary(params: {
  reviewOutputKey: string;
  filesReviewed: number;
  linesAdded: number;
  linesRemoved: number;
  findingCounts: {
    critical: number;
    major: number;
    medium: number;
    minor: number;
  };
  largePRTriage?: {
    fullCount: number;
    abbreviatedCount: number;
    mentionOnlyFiles: Array<{ filePath: string; score: number }>;
    totalFiles: number;
  };
  reviewBoundedness?: ReviewBoundednessContract | null;
  reviewFirstPass?: ReviewFirstPassPayload | null;
  feedbackSuppressionCount?: number;
  keywordParsing?: ParsedPRIntent;
  profileSelection: ResolvedReviewProfile;
  contributorExperience: ContributorExperienceReviewDetailsProjection;
  shadowSpecialistReviewDetails?: {
    readonly reviewDetailsLine: string;
  } | null;
  candidateVerificationPublicationEvidence?: CandidateVerificationPublicationEvidenceReviewDetails | null;
  candidatePublicationBridge?: CandidatePublicationBridgeReviewDetails | null;
  reviewPlan?: ReviewPlanDetailsSummary | null;
  reviewReducer?: ReviewReducerDetailsSummary | null;
  reviewCandidateFinding?: ReviewCandidateFindingDetailsSummary | null;
  reviewCandidatePublication?: ReviewCandidatePublicationRuntimeDetailsSummary | null;
  reviewFindingLifecycle?: ReviewFindingLifecyclePublicProjection | null;
  reviewValidationTruth?: ValidationTruthProjection | null;
  prioritization?: {
    findingsScored: number;
    topScore: number | null;
    thresholdScore: number | null;
    maxComments?: number;
    selectedFindings?: number;
    omittedFindings?: number;
  };
  usageLimit?: {
    utilization: number | undefined;
    rateLimitType: string | undefined;
    resetsAt: number | undefined;
  };
  tokenUsage?: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    costUsd: number | undefined;
  };
  structuralImpact?: StructuralImpactPayload | null;
  phaseTimingSummary?: ReviewDetailsPhaseTimingSummary | null;
  timeoutProgress?: TimeoutReviewDetailsProgress | null;
  timeoutBudget?: TimeoutBudgetDetails | null;
  lineCountSource?: ReviewDetailsLineCountSource;
  completedAt?: string;
}): string {
  const {
    reviewOutputKey,
    filesReviewed,
    linesAdded,
    linesRemoved,
    findingCounts,
    largePRTriage,
    reviewBoundedness,
    reviewFirstPass,
    feedbackSuppressionCount,
    keywordParsing,
    profileSelection,
    contributorExperience,
    shadowSpecialistReviewDetails,
    candidateVerificationPublicationEvidence,
    candidatePublicationBridge,
    reviewPlan,
    reviewReducer,
    reviewCandidateFinding,
    reviewCandidatePublication,
    reviewFindingLifecycle,
    reviewValidationTruth,
    prioritization,
    usageLimit,
    tokenUsage,
    structuralImpact,
    phaseTimingSummary,
    timeoutProgress,
    timeoutBudget,
    lineCountSource = "local-diff",
  } = params;

  const formatProfileLine = (label: string, profile: ResolvedReviewProfile): string => {
    if (profile.source === "auto") {
      return `- ${label}: ${profile.selectedProfile} (auto, lines changed: ${profile.linesChanged})`;
    }

    if (profile.source === "manual") {
      return `- ${label}: ${profile.selectedProfile} (manual config)`;
    }

    return `- ${label}: ${profile.selectedProfile} (keyword override)`;
  };

  const profileLine = profileSelection.source === "auto"
    ? `- Profile: ${profileSelection.selectedProfile} (auto, lines changed: ${profileSelection.linesChanged})`
    : profileSelection.source === "manual"
      ? `- Profile: ${profileSelection.selectedProfile} (manual config)`
      : `- Profile: ${profileSelection.selectedProfile} (keyword override)`;
  const hasBoundedProfileDetails = Boolean(reviewBoundedness && reviewBoundedness.reasonCodes.length > 0);

  const primaryReviewDetailLines = reviewFirstPass
    ? describeReviewFirstPass(reviewFirstPass).detailLines
    : timeoutProgress
      ? []
      : [
          `- Files reviewed: ${filesReviewed}`,
          `- Findings: ${findingCounts.critical} critical, ${findingCounts.major} major, ${findingCounts.medium} medium, ${findingCounts.minor} minor`,
        ];

  const timeoutProgressLines = timeoutProgress
    ? [
        `- Analyzed progress before timeout: ${timeoutProgress.analyzedFiles}/${timeoutProgress.totalFiles} changed files`,
        `- Findings captured before timeout: ${timeoutProgress.findingCount} total`,
        ...(timeoutBudget
          ? [
              `- Timeout budget: remote runtime ${timeoutBudget.remoteRuntimeBudgetSeconds}s + infra overhead ${timeoutBudget.infraOverheadBudgetSeconds}s = total ${timeoutBudget.totalTimeoutSeconds}s`,
            ]
          : []),
        `- Retry state: ${timeoutProgress.retryState}`,
      ]
    : [];

  const lineCountText = lineCountSource === "github-pr-api-fallback"
    ? `- Lines changed: +${linesAdded} -${linesRemoved} (GitHub PR API fallback; local diff stats unavailable)`
    : `- Lines changed: +${linesAdded} -${linesRemoved}`;


  const candidatePublicationBridgeLines: string[] = [];
  try {
    const line = formatCandidatePublicationBridgeLine(candidatePublicationBridge);
    if (line) {
      candidatePublicationBridgeLines.push(line);
    }
  } catch {
    // Keep Review Details fail-open; malformed M072 bridge projections must not block publication.
  }

  const candidateVerificationPublicationEvidenceLines: string[] = [];
  try {
    const line = formatCandidateVerificationPublicationEvidenceLine(candidateVerificationPublicationEvidence);
    if (line) {
      candidateVerificationPublicationEvidenceLines.push(line);
    }
  } catch {
    // Keep Review Details fail-open; malformed diagnostic projections must not block publication.
  }

  const reviewFindingLifecycleLines: string[] = [];
  try {
    const line = formatReviewFindingLifecycleDetailsLine(reviewFindingLifecycle);
    if (line) {
      reviewFindingLifecycleLines.push(line);
    }
  } catch {
    // Keep Review Details fail-open; malformed lifecycle projections must not block publication.
  }

  const reviewValidationTruthLines: string[] = [];
  try {
    const line = formatReviewValidationTruthDetailsLine(reviewValidationTruth);
    if (line) {
      reviewValidationTruthLines.push(line);
    }
  } catch {
    // Keep Review Details fail-open; malformed validation truth projections must not block publication.
  }

  const sections = [
    "<details>",
    "<summary>Review Details</summary>",
    "",
    ...formatReviewPlanDetailsLine(reviewPlan),
    ...formatReviewReducerDetailsLine(reviewReducer),
    ...formatReviewCandidateFindingDetailsLine(reviewCandidateFinding),
    ...formatReviewCandidatePublicationDetailsLine(reviewCandidatePublication),
    ...primaryReviewDetailLines,
    ...timeoutProgressLines,
    lineCountText,
    ...(hasBoundedProfileDetails && reviewBoundedness
      ? [
          formatProfileLine("Requested profile", reviewBoundedness.requestedProfile),
          `- Effective profile: ${reviewBoundedness.effectiveProfile.selectedProfile}`,
          ...(reviewBoundedness.largePR
            ? [
                `- Bounded review: covered ${reviewBoundedness.largePR.reviewedCount}/${reviewBoundedness.largePR.totalFiles} changed files via large-PR triage (${reviewBoundedness.largePR.fullCount} full, ${reviewBoundedness.largePR.abbreviatedCount} abbreviated; ${reviewBoundedness.largePR.notReviewedCount} not reviewed)`,
              ]
            : []),
          ...(reviewBoundedness.timeout?.reductionApplied
            ? ["- Timeout auto-reduction: applied"]
            : reviewBoundedness.timeout?.reductionSkippedReason === "explicit-profile"
              ? ["- Timeout auto-reduction: skipped (explicit profile)"]
              : reviewBoundedness.timeout?.reductionSkippedReason === "config-disabled"
                ? ["- Timeout auto-reduction: skipped (config disabled)"]
                : []),
        ]
      : [profileLine]),
    `- Contributor experience: ${contributorExperience.text}`,
    ...(shadowSpecialistReviewDetails?.reviewDetailsLine
      ? [`- ${shadowSpecialistReviewDetails.reviewDetailsLine}`]
      : []),
    ...candidatePublicationBridgeLines,
    ...candidateVerificationPublicationEvidenceLines,
    ...reviewFindingLifecycleLines,
    ...reviewValidationTruthLines,
    `- Review completed: ${params.completedAt ?? new Date().toISOString()}`,
  ];

  if (phaseTimingSummary) {
    try {
      const phaseTimingLines = formatReviewDetailsPhaseTimingSummary(phaseTimingSummary);
      if (phaseTimingLines.length > 0) {
        sections.push("", ...phaseTimingLines);
      }
    } catch {
      // Keep Review Details publication fail-open if timing formatting regresses.
    }
  }

  if (usageLimit?.utilization !== undefined) {
    const pct = Math.round(usageLimit.utilization * 100);
    const pctLeft = 100 - pct;
    const type = usageLimit.rateLimitType ?? 'usage';
    const resetStr = usageLimit.resetsAt !== undefined
      ? ` | resets ${new Date(usageLimit.resetsAt * 1000).toISOString()}`
      : '';
    sections.push(`- Claude Code usage: ${pctLeft}% of ${type} limit remaining${resetStr}`);
  }

  if (tokenUsage?.inputTokens !== undefined || tokenUsage?.outputTokens !== undefined) {
    const inp = tokenUsage?.inputTokens ?? 0;
    const out = tokenUsage?.outputTokens ?? 0;
    const costStr = tokenUsage?.costUsd !== undefined ? ` | ${tokenUsage.costUsd.toFixed(4)}` : '';
    sections.push(`- Tokens: ${inp.toLocaleString()} in / ${out.toLocaleString()} out${costStr}`);
  }

  if (largePRTriage) {
    const reviewedCount = largePRTriage.fullCount + largePRTriage.abbreviatedCount;
    const notReviewedCount = largePRTriage.totalFiles - reviewedCount;

    sections.push(
      "",
      `- Review scope: Reviewed ${reviewedCount}/${largePRTriage.totalFiles} files, prioritized by risk`,
      `- Full review: ${largePRTriage.fullCount} files | Abbreviated review: ${largePRTriage.abbreviatedCount} files | Not reviewed: ${notReviewedCount} files`,
    );

    if (largePRTriage.mentionOnlyFiles.length > 0) {
      const MAX_MENTION_ONLY_ENTRIES = 100;
      const cappedFiles = largePRTriage.mentionOnlyFiles.slice(0, MAX_MENTION_ONLY_ENTRIES);
      const remaining = largePRTriage.mentionOnlyFiles.length - cappedFiles.length;

      sections.push(
        "",
        "<details>",
        "<summary>Files not fully reviewed (sorted by risk score)</summary>",
        "",
      );

      for (const file of cappedFiles) {
        sections.push(`- ${file.filePath} (risk: ${file.score})`);
      }

      if (remaining > 0) {
        sections.push(`- ...and ${remaining} more files`);
      }

      sections.push("", "</details>");
    }
  }

  if (feedbackSuppressionCount && feedbackSuppressionCount > 0) {
    sections.push(`- ${feedbackSuppressionCount} pattern${feedbackSuppressionCount === 1 ? '' : 's'} auto-suppressed by feedback`);
  }

  if (prioritization) {
    const hasSaturatedCommentCap =
      typeof prioritization.maxComments === "number" &&
      typeof prioritization.selectedFindings === "number" &&
      typeof prioritization.omittedFindings === "number" &&
      prioritization.omittedFindings > 0;

    if (hasSaturatedCommentCap) {
      const omittedFindingLabel = prioritization.omittedFindings === 1 ? "finding" : "findings";
      sections.push(
        `- Comment cap saturated: published ${prioritization.selectedFindings}/${prioritization.findingsScored} prioritized findings; ${prioritization.omittedFindings} lower-priority ${omittedFindingLabel} omitted from inline publication`,
      );
    }

    sections.push(
      `- Prioritization: scored ${prioritization.findingsScored} findings | top score ${prioritization.topScore ?? "n/a"} | threshold score ${prioritization.thresholdScore ?? "n/a"}`,
    );
  }

  const structuralImpactSection = buildStructuralImpactSection(structuralImpact);
  if (structuralImpactSection.text) {
    const structuralImpactDegradation = summarizeStructuralImpactDegradation(structuralImpact);
    sections.push(structuralImpactSection.text);
    sections.push(
      `- Structural Impact rendered: callers ${structuralImpactSection.stats.callersRendered}/${structuralImpactSection.stats.callersTotal}${structuralImpactSection.stats.callersTruncated ? " truncated" : ""}; files ${structuralImpactSection.stats.filesRendered}/${structuralImpactSection.stats.filesTotal}${structuralImpactSection.stats.filesTruncated ? " truncated" : ""}; tests ${structuralImpactSection.stats.testsRendered}/${structuralImpactSection.stats.testsTotal}${structuralImpactSection.stats.testsTruncated ? " truncated" : ""}; unchanged evidence ${structuralImpactSection.stats.evidenceRendered}/${structuralImpactSection.stats.evidenceTotal}${structuralImpactSection.stats.evidenceTruncated ? " truncated" : ""}`,
    );
    if (structuralImpactDegradation.fallbackUsed) {
      sections.push(
        `- Structural Impact degradation: status ${structuralImpactDegradation.status}; graph ${structuralImpactDegradation.availability.graphAvailable ? "available" : "unavailable"}; corpus ${structuralImpactDegradation.availability.corpusAvailable ? "available" : "unavailable"}; signals ${structuralImpactDegradation.truthfulnessSignals.join(", ")}`,
      );
    }
  }

  const keywordSection = buildKeywordParsingSection(
    keywordParsing ?? DEFAULT_EMPTY_INTENT,
  );
  sections.push(keywordSection);

  sections.push(
    "",
    "</details>",
    "",
    buildReviewDetailsMarker(reviewOutputKey),
  );

  return sections.join("\n");
}
