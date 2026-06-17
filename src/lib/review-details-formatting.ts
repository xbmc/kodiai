/**
 * Final assembly for the Review Details block.
 */

import {
  buildKeywordParsingSection,
  DEFAULT_EMPTY_INTENT,
  type ParsedPRIntent,
} from "./pr-intent-parser.ts";
import type { ResolvedReviewProfile } from "./auto-profile.ts";
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
  formatReviewCandidateFindingDetailsLine,
  formatReviewCandidatePublicationDetailsLine,
  formatCandidatePublicationBridgeLine,
  type CandidatePublicationBridgeReviewDetails,
  formatCandidateVerificationPublicationEvidenceLine,
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
export type { CandidatePublicationBridgeReviewDetails } from "./review-details-candidate-bridge-formatting.ts";
export type { CandidateVerificationPublicationEvidenceReviewDetails } from "./review-details-candidate-verification-formatting.ts";

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

type FindingCounts = {
  critical: number;
  major: number;
  medium: number;
  minor: number;
};

type LargePrTriageDetails = {
  fullCount: number;
  abbreviatedCount: number;
  mentionOnlyFiles: Array<{ filePath: string; score: number }>;
  totalFiles: number;
};

type PrioritizationDetails = {
  findingsScored: number;
  topScore: number | null;
  thresholdScore: number | null;
  maxComments?: number;
  selectedFindings?: number;
  omittedFindings?: number;
};

type UsageLimitDetails = {
  utilization: number | undefined;
  rateLimitType: string | undefined;
  resetsAt: number | undefined;
};

type TokenUsageDetails = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  costUsd: number | undefined;
};

export type ReviewDetailsSummaryParams = {
  reviewOutputKey: string;
  filesReviewed: number;
  linesAdded: number;
  linesRemoved: number;
  findingCounts: FindingCounts;
  largePRTriage?: LargePrTriageDetails;
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
  prioritization?: PrioritizationDetails;
  usageLimit?: UsageLimitDetails;
  tokenUsage?: TokenUsageDetails;
  structuralImpact?: StructuralImpactPayload | null;
  phaseTimingSummary?: ReviewDetailsPhaseTimingSummary | null;
  timeoutProgress?: TimeoutReviewDetailsProgress | null;
  timeoutBudget?: TimeoutBudgetDetails | null;
  lineCountSource?: ReviewDetailsLineCountSource;
  completedAt?: string;
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

function optionalReviewDetailsLine<T>(
  value: T,
  formatter: (value: T) => string | null,
): string[] {
  try {
    const line = formatter(value);
    return line ? [line] : [];
  } catch {
    return [];
  }
}

function formatProfileLine(label: string, profile: ResolvedReviewProfile): string {
  if (profile.source === "auto") {
    return `- ${label}: ${profile.selectedProfile} (auto, lines changed: ${profile.linesChanged})`;
  }

  if (profile.source === "manual") {
    return `- ${label}: ${profile.selectedProfile} (manual config)`;
  }

  return `- ${label}: ${profile.selectedProfile} (keyword override)`;
}

function formatPrimaryReviewDetailLines(params: {
  filesReviewed: number;
  findingCounts: FindingCounts;
  reviewFirstPass?: ReviewFirstPassPayload | null;
  timeoutProgress?: TimeoutReviewDetailsProgress | null;
}): string[] {
  if (params.reviewFirstPass) return describeReviewFirstPass(params.reviewFirstPass).detailLines;
  if (params.timeoutProgress) return [];
  return [
    `- Files reviewed: ${params.filesReviewed}`,
    `- Findings: ${params.findingCounts.critical} critical, ${params.findingCounts.major} major, ${params.findingCounts.medium} medium, ${params.findingCounts.minor} minor`,
  ];
}

function formatTimeoutProgressSection(params: {
  timeoutProgress?: TimeoutReviewDetailsProgress | null;
  timeoutBudget?: TimeoutBudgetDetails | null;
}): string[] {
  const { timeoutProgress, timeoutBudget } = params;
  if (!timeoutProgress) return [];
  return [
    `- Analyzed progress before timeout: ${timeoutProgress.analyzedFiles}/${timeoutProgress.totalFiles} changed files`,
    `- Findings captured before timeout: ${timeoutProgress.findingCount} total`,
    ...(timeoutBudget
      ? [
          `- Timeout budget: remote runtime ${timeoutBudget.remoteRuntimeBudgetSeconds}s + infra overhead ${timeoutBudget.infraOverheadBudgetSeconds}s = total ${timeoutBudget.totalTimeoutSeconds}s`,
        ]
      : []),
    `- Retry state: ${timeoutProgress.retryState}`,
  ];
}

function formatLineCountLine(params: {
  linesAdded: number;
  linesRemoved: number;
  lineCountSource: ReviewDetailsLineCountSource;
}): string {
  return params.lineCountSource === "github-pr-api-fallback"
    ? `- Lines changed: +${params.linesAdded} -${params.linesRemoved} (GitHub PR API fallback; local diff stats unavailable)`
    : `- Lines changed: +${params.linesAdded} -${params.linesRemoved}`;
}

function formatProfileSection(params: {
  profileSelection: ResolvedReviewProfile;
  reviewBoundedness?: ReviewBoundednessContract | null;
}): string[] {
  const { profileSelection, reviewBoundedness } = params;
  if (!reviewBoundedness || reviewBoundedness.reasonCodes.length === 0) {
    return [formatProfileLine("Profile", profileSelection)];
  }

  return [
    formatProfileLine("Requested profile", reviewBoundedness.requestedProfile),
    `- Effective profile: ${reviewBoundedness.effectiveProfile.selectedProfile}`,
    ...(reviewBoundedness.largePR
      ? [
          `- Bounded review: covered ${reviewBoundedness.largePR.reviewedCount}/${reviewBoundedness.largePR.totalFiles} changed files via large-PR triage (${reviewBoundedness.largePR.fullCount} full, ${reviewBoundedness.largePR.abbreviatedCount} abbreviated; ${reviewBoundedness.largePR.notReviewedCount} not reviewed)`,
        ]
      : []),
    ...formatTimeoutReductionLines(reviewBoundedness),
  ];
}

function formatTimeoutReductionLines(reviewBoundedness: ReviewBoundednessContract): string[] {
  if (reviewBoundedness.timeout?.reductionApplied) return ["- Timeout auto-reduction: applied"];
  if (reviewBoundedness.timeout?.reductionSkippedReason === "explicit-profile") {
    return ["- Timeout auto-reduction: skipped (explicit profile)"];
  }
  if (reviewBoundedness.timeout?.reductionSkippedReason === "config-disabled") {
    return ["- Timeout auto-reduction: skipped (config disabled)"];
  }
  return [];
}

function formatCoreReviewDetailsSection(params: ReviewDetailsSummaryParams & {
  lineCountSource: ReviewDetailsLineCountSource;
}): string[] {
  return [
    ...formatPrimaryReviewDetailLines(params),
    ...formatTimeoutProgressSection(params),
    formatLineCountLine(params),
    ...formatProfileSection(params),
    `- Contributor experience: ${params.contributorExperience.text}`,
    ...(params.shadowSpecialistReviewDetails?.reviewDetailsLine
      ? [`- ${params.shadowSpecialistReviewDetails.reviewDetailsLine}`]
      : []),
    `- Review completed: ${params.completedAt ?? new Date().toISOString()}`,
  ];
}

function formatPublicationDiagnosticsSection(params: ReviewDetailsSummaryParams): string[] {
  return [
    ...formatReviewPlanDetailsLine(params.reviewPlan),
    ...formatReviewReducerDetailsLine(params.reviewReducer),
    ...formatReviewCandidateFindingDetailsLine(params.reviewCandidateFinding),
    ...formatReviewCandidatePublicationDetailsLine(params.reviewCandidatePublication),
    ...optionalReviewDetailsLine(params.candidatePublicationBridge, formatCandidatePublicationBridgeLine),
    ...optionalReviewDetailsLine(params.candidateVerificationPublicationEvidence, formatCandidateVerificationPublicationEvidenceLine),
    ...optionalReviewDetailsLine(params.reviewFindingLifecycle, formatReviewFindingLifecycleDetailsLine),
    ...optionalReviewDetailsLine(params.reviewValidationTruth, formatReviewValidationTruthDetailsLine),
  ];
}

function formatPhaseTimingSection(
  phaseTimingSummary?: ReviewDetailsPhaseTimingSummary | null,
): string[] {
  if (!phaseTimingSummary) return [];
  try {
    const lines = formatReviewDetailsPhaseTimingSummary(phaseTimingSummary);
    return lines.length > 0 ? ["", ...lines] : [];
  } catch {
    return [];
  }
}

function formatUsageLimitSection(usageLimit?: UsageLimitDetails): string[] {
  if (usageLimit?.utilization === undefined) return [];
  const pct = Math.round(usageLimit.utilization * 100);
  const pctLeft = 100 - pct;
  const type = usageLimit.rateLimitType ?? "usage";
  const resetStr = usageLimit.resetsAt !== undefined
    ? ` | resets ${new Date(usageLimit.resetsAt * 1000).toISOString()}`
    : "";
  return [`- Claude Code usage: ${pctLeft}% of ${type} limit remaining${resetStr}`];
}

function formatTokenUsageSection(tokenUsage?: TokenUsageDetails): string[] {
  if (tokenUsage?.inputTokens === undefined && tokenUsage?.outputTokens === undefined) return [];
  const inp = tokenUsage.inputTokens ?? 0;
  const out = tokenUsage.outputTokens ?? 0;
  const costStr = tokenUsage.costUsd !== undefined ? ` | ${tokenUsage.costUsd.toFixed(4)}` : "";
  return [`- Tokens: ${inp.toLocaleString()} in / ${out.toLocaleString()} out${costStr}`];
}

function formatLargePrTriageSection(largePRTriage?: LargePrTriageDetails): string[] {
  if (!largePRTriage) return [];
  const { abbreviatedCount, fullCount, mentionOnlyFiles, totalFiles } = largePRTriage;
  const reviewedCount = fullCount + abbreviatedCount;
  const notReviewedCount = totalFiles - reviewedCount;
  const lines = [
    "",
    `- Review scope: Reviewed ${reviewedCount}/${totalFiles} files, prioritized by risk`,
    `- Full review: ${fullCount} files | Abbreviated review: ${abbreviatedCount} files | Not reviewed: ${notReviewedCount} files`,
  ];

  if (mentionOnlyFiles.length === 0) return lines;

  const MAX_MENTION_ONLY_ENTRIES = 100;
  const cappedFiles = mentionOnlyFiles.slice(0, MAX_MENTION_ONLY_ENTRIES);
  const remaining = mentionOnlyFiles.length - cappedFiles.length;
  lines.push(
    "",
    "<details>",
    "<summary>Files not fully reviewed (sorted by risk score)</summary>",
    "",
    ...cappedFiles.map((file) => `- ${file.filePath} (risk: ${file.score})`),
    ...(remaining > 0 ? [`- ...and ${remaining} more files`] : []),
    "",
    "</details>",
  );

  return lines;
}

function formatFeedbackSuppressionSection(feedbackSuppressionCount?: number): string[] {
  if (!feedbackSuppressionCount || feedbackSuppressionCount <= 0) return [];
  return [`- ${feedbackSuppressionCount} pattern${feedbackSuppressionCount === 1 ? "" : "s"} auto-suppressed by feedback`];
}

function formatPrioritizationSection(prioritization?: PrioritizationDetails): string[] {
  if (!prioritization) return [];
  const hasSaturatedCommentCap =
    typeof prioritization.maxComments === "number" &&
    typeof prioritization.selectedFindings === "number" &&
    typeof prioritization.omittedFindings === "number" &&
    prioritization.omittedFindings > 0;

  return [
    ...(hasSaturatedCommentCap
      ? [
          `- Comment cap saturated: published ${prioritization.selectedFindings}/${prioritization.findingsScored} prioritized findings; ${prioritization.omittedFindings} lower-priority ${prioritization.omittedFindings === 1 ? "finding" : "findings"} omitted from inline publication`,
        ]
      : []),
    `- Prioritization: scored ${prioritization.findingsScored} findings | top score ${prioritization.topScore ?? "n/a"} | threshold score ${prioritization.thresholdScore ?? "n/a"}`,
  ];
}

function formatStructuralImpactSection(structuralImpact?: StructuralImpactPayload | null): string[] {
  const section = buildStructuralImpactSection(structuralImpact);
  if (!section.text) return [];

  const degradation = summarizeStructuralImpactDegradation(structuralImpact);
  return [
    section.text,
    `- Structural Impact rendered: callers ${section.stats.callersRendered}/${section.stats.callersTotal}${section.stats.callersTruncated ? " truncated" : ""}; files ${section.stats.filesRendered}/${section.stats.filesTotal}${section.stats.filesTruncated ? " truncated" : ""}; tests ${section.stats.testsRendered}/${section.stats.testsTotal}${section.stats.testsTruncated ? " truncated" : ""}; unchanged evidence ${section.stats.evidenceRendered}/${section.stats.evidenceTotal}${section.stats.evidenceTruncated ? " truncated" : ""}`,
    ...(degradation.fallbackUsed
      ? [
          `- Structural Impact degradation: status ${degradation.status}; graph ${degradation.availability.graphAvailable ? "available" : "unavailable"}; corpus ${degradation.availability.corpusAvailable ? "available" : "unavailable"}; signals ${degradation.truthfulnessSignals.join(", ")}`,
        ]
      : []),
  ];
}

function formatKeywordParsingSection(keywordParsing?: ParsedPRIntent): string[] {
  return [buildKeywordParsingSection(keywordParsing ?? DEFAULT_EMPTY_INTENT)];
}

export function formatReviewDetailsSummary(params: ReviewDetailsSummaryParams): string {
  const lineCountSource = params.lineCountSource ?? "local-diff";
  const sections = [
    "<details>",
    "<summary>Review Details</summary>",
    "",
    ...formatPublicationDiagnosticsSection(params),
    ...formatCoreReviewDetailsSection({ ...params, lineCountSource }),
    ...formatPhaseTimingSection(params.phaseTimingSummary),
    ...formatUsageLimitSection(params.usageLimit),
    ...formatTokenUsageSection(params.tokenUsage),
    ...formatLargePrTriageSection(params.largePRTriage),
    ...formatFeedbackSuppressionSection(params.feedbackSuppressionCount),
    ...formatPrioritizationSection(params.prioritization),
    ...formatStructuralImpactSection(params.structuralImpact),
    ...formatKeywordParsingSection(params.keywordParsing),
    "",
    "</details>",
    "",
    buildReviewDetailsMarker(params.reviewOutputKey),
  ];

  return sections.join("\n");
}
