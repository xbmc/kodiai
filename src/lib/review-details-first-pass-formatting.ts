import type { ReviewFirstPassPayload } from "./review-first-pass.ts";

export type TimeoutBudgetDetails = {
  remoteRuntimeBudgetSeconds: number;
  infraOverheadBudgetSeconds: number;
  totalTimeoutSeconds: number;
};

function formatBoundedReason(reason: ReviewFirstPassPayload["boundedReason"]): string {
  if (reason === "max-turns") {
    return "max-turns";
  }
  if (reason === "large-pr") {
    return "large-PR triage";
  }
  return "timeout";
}

function formatEvidenceSource(source: ReviewFirstPassPayload["evidenceSource"]): string {
  if (source === "checkpoint") {
    return "checkpoint evidence";
  }
  if (source === "boundedness") {
    return "boundedness evidence";
  }
  return "no trustworthy evidence";
}

function formatTimeoutSuffix(
  timedOutAfterSeconds?: number,
  timeoutBudget?: TimeoutBudgetDetails | null,
): string {
  if (timeoutBudget) {
    return ` (timeout budget: remote runtime ${timeoutBudget.remoteRuntimeBudgetSeconds}s + infra overhead ${timeoutBudget.infraOverheadBudgetSeconds}s = total ${timeoutBudget.totalTimeoutSeconds}s)`;
  }

  return typeof timedOutAfterSeconds === "number" ? ` (${timedOutAfterSeconds}s timeout)` : "";
}

function formatCoverageClause(firstPass: ReviewFirstPassPayload, evidenceLabel: string): string {
  if (firstPass.coveredScope) {
    return `after covering ${firstPass.coveredScope.reviewedFiles} of ${firstPass.coveredScope.totalFiles} files from ${evidenceLabel}`;
  }

  return `using ${evidenceLabel}`;
}

function formatRemainingScopeSummary(firstPass: ReviewFirstPassPayload): string {
  if (firstPass.remainingScope) {
    return `${firstPass.remainingScope.remainingFiles} of ${firstPass.remainingScope.totalFiles} files remain unreviewed`;
  }

  if (firstPass.continuationPending) {
    return "remaining scope is not confirmed from structured evidence";
  }

  return "remaining scope is not confirmed from structured evidence";
}

function formatContinuationSummary(firstPass: ReviewFirstPassPayload): string {
  if (firstPass.continuationPending) {
    return "follow-up review is pending";
  }

  return "no follow-up review is pending";
}

function formatContinuationDetail(firstPass: ReviewFirstPassPayload): string {
  if (firstPass.state === "zero-evidence-failure") {
    return "- Continuation state: stopped after first pass; no follow-up review is pending";
  }

  if (firstPass.continuationPending) {
    if (firstPass.remainingScope) {
      return "- Continuation state: follow-up review pending for remaining scope";
    }

    return "- Continuation state: follow-up review pending; remaining scope still unconfirmed";
  }

  if (firstPass.remainingScope) {
    return `- Continuation state: stopped after first pass; ${firstPass.remainingScope.remainingFiles}/${firstPass.remainingScope.totalFiles} files remain unreviewed`;
  }

  return "- Continuation state: stopped after first pass; no follow-up review is pending";
}

export function buildReviewFirstPassPublicSummary(
  firstPass: ReviewFirstPassPayload,
  timedOutAfterSeconds?: number,
  timeoutBudget?: TimeoutBudgetDetails | null,
): string {
  const reasonLabel = formatBoundedReason(firstPass.boundedReason);
  const evidenceLabel = formatEvidenceSource(firstPass.evidenceSource);

  if (firstPass.state === "zero-evidence-failure") {
    return `hit ${reasonLabel} with no trustworthy structured evidence${formatTimeoutSuffix(
      firstPass.boundedReason === "timeout" ? timedOutAfterSeconds : undefined,
      firstPass.boundedReason === "timeout" ? timeoutBudget : undefined,
    )}`;
  }

  return [
    `stopped at ${reasonLabel} ${formatCoverageClause(firstPass, evidenceLabel)}`,
    formatRemainingScopeSummary(firstPass),
    `${formatContinuationSummary(firstPass)}${formatTimeoutSuffix(
      firstPass.boundedReason === "timeout" ? timedOutAfterSeconds : undefined,
      firstPass.boundedReason === "timeout" ? timeoutBudget : undefined,
    )}`,
  ].join("; ");
}

export function describeReviewFirstPass(firstPass: ReviewFirstPassPayload): {
  reasonLabel: string;
  evidenceLabel: string;
  summaryClause: (
    timedOutAfterSeconds?: number,
    timeoutBudget?: TimeoutBudgetDetails | null,
  ) => string;
  detailLines: string[];
} {
  const reasonLabel = formatBoundedReason(firstPass.boundedReason);
  const evidenceLabel = formatEvidenceSource(firstPass.evidenceSource);

  const summaryClause = (
    timedOutAfterSeconds?: number,
    timeoutBudget?: TimeoutBudgetDetails | null,
  ): string => {
    return buildReviewFirstPassPublicSummary(
      firstPass,
      timedOutAfterSeconds,
      timeoutBudget,
    );
  };

  if (firstPass.state === "zero-evidence-failure") {
    return {
      reasonLabel,
      evidenceLabel,
      summaryClause,
      detailLines: [
        `- Constrained outcome: zero-evidence hard failure after ${reasonLabel}`,
        "- Publication eligibility: ineligible",
        formatContinuationDetail(firstPass),
      ],
    };
  }

  const detailLines = [
    `- Bounded first-pass: ${reasonLabel} via ${evidenceLabel}`,
    ...(firstPass.coveredScope
      ? [`- Covered scope: ${firstPass.coveredScope.reviewedFiles}/${firstPass.coveredScope.totalFiles} changed files`]
      : []),
    ...(firstPass.inspectedScope
      ? [`- Inspected before ${reasonLabel}: ${firstPass.inspectedScope.inspectedFiles}/${firstPass.inspectedScope.totalFiles} changed files`]
      : []),
    ...(firstPass.remainingScope
      ? [`- Remaining scope: ${firstPass.remainingScope.remainingFiles}/${firstPass.remainingScope.totalFiles} changed files`]
      : ["- Remaining scope: not confirmed from structured evidence"]),
    ...(typeof firstPass.findingCount === "number"
      ? [`- First-pass findings captured: ${firstPass.findingCount}`]
      : []),
    `- Publication eligibility: ${firstPass.publication.eligible ? "eligible" : "ineligible"}`,
    ...(firstPass.publication.hasPublishedOutput ? ["- Public review output already exists for this first pass"] : []),
    formatContinuationDetail(firstPass),
  ];

  return {
    reasonLabel,
    evidenceLabel,
    summaryClause,
    detailLines,
  };
}
