import type { ResolvedReviewProfile } from "./auto-profile.ts";
import type { TimeoutRiskLevel } from "./timeout-estimator.ts";

export type ReviewBoundednessReasonCode =
  | "large-pr-triage"
  | "timeout-auto-reduced"
  | "timeout-auto-reduction-skipped-explicit-profile"
  | "timeout-auto-reduction-skipped-config-disabled";

export type ReviewBoundednessLargePR = {
  fullCount: number;
  abbreviatedCount: number;
  reviewedCount: number;
  totalFiles: number;
  notReviewedCount: number;
};

export type ReviewBoundednessTimeout = {
  riskLevel: TimeoutRiskLevel;
  dynamicTimeoutSeconds: number;
  shouldReduceScope: boolean;
  reductionApplied: boolean;
  reductionSkippedReason: "explicit-profile" | "config-disabled" | null;
};

export type ReviewBoundednessContract = {
  requestedProfile: ResolvedReviewProfile;
  effectiveProfile: ResolvedReviewProfile;
  reasonCodes: ReviewBoundednessReasonCode[];
  disclosureRequired: boolean;
  disclosureSentence: string | null;
  largePR: ReviewBoundednessLargePR | null;
  timeout: ReviewBoundednessTimeout | null;
};

function isResolvedReviewProfile(value: unknown): value is ResolvedReviewProfile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ResolvedReviewProfile>;
  return (
    (candidate.selectedProfile === "strict" ||
      candidate.selectedProfile === "balanced" ||
      candidate.selectedProfile === "minimal") &&
    (candidate.source === "keyword" || candidate.source === "manual" || candidate.source === "auto") &&
    (candidate.autoBand === null ||
      candidate.autoBand === "small" ||
      candidate.autoBand === "medium" ||
      candidate.autoBand === "large") &&
    typeof candidate.linesChanged === "number" &&
    Number.isFinite(candidate.linesChanged) &&
    candidate.linesChanged >= 0
  );
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeLargePR(value: unknown): ReviewBoundednessLargePR | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as {
    fullCount?: unknown;
    abbreviatedCount?: unknown;
    totalFiles?: unknown;
  };

  if (
    !isFiniteNonNegativeNumber(candidate.fullCount) ||
    !isFiniteNonNegativeNumber(candidate.abbreviatedCount) ||
    !isFiniteNonNegativeNumber(candidate.totalFiles)
  ) {
    return null;
  }

  const reviewedCount = candidate.fullCount + candidate.abbreviatedCount;
  if (reviewedCount > candidate.totalFiles) {
    return null;
  }

  return {
    fullCount: candidate.fullCount,
    abbreviatedCount: candidate.abbreviatedCount,
    reviewedCount,
    totalFiles: candidate.totalFiles,
    notReviewedCount: candidate.totalFiles - reviewedCount,
  };
}

function normalizeTimeout(value: unknown): ReviewBoundednessTimeout | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as {
    riskLevel?: unknown;
    dynamicTimeoutSeconds?: unknown;
    shouldReduceScope?: unknown;
    reductionApplied?: unknown;
    reductionSkippedReason?: unknown;
  };

  if (
    (candidate.riskLevel !== "low" && candidate.riskLevel !== "medium" && candidate.riskLevel !== "high") ||
    !isFiniteNonNegativeNumber(candidate.dynamicTimeoutSeconds) ||
    typeof candidate.shouldReduceScope !== "boolean" ||
    typeof candidate.reductionApplied !== "boolean" ||
    (candidate.reductionSkippedReason !== null &&
      candidate.reductionSkippedReason !== undefined &&
      candidate.reductionSkippedReason !== "explicit-profile" &&
      candidate.reductionSkippedReason !== "config-disabled")
  ) {
    return null;
  }

  return {
    riskLevel: candidate.riskLevel,
    dynamicTimeoutSeconds: candidate.dynamicTimeoutSeconds,
    shouldReduceScope: candidate.shouldReduceScope,
    reductionApplied: candidate.reductionApplied,
    reductionSkippedReason: candidate.reductionSkippedReason ?? null,
  };
}

function buildRequestedProfilePrefix(profile: ResolvedReviewProfile): string {
  if (profile.source === "auto") {
    return `Requested ${profile.selectedProfile} review`;
  }

  return `Requested ${profile.selectedProfile} review`;
}

function buildEffectiveProfileClause(params: {
  requestedProfile: ResolvedReviewProfile;
  effectiveProfile: ResolvedReviewProfile;
  timeout: ReviewBoundednessTimeout | null;
}): string {
  const { requestedProfile, effectiveProfile, timeout } = params;

  if (timeout?.reductionApplied) {
    return `timeout risk auto-reduced the effective review to ${effectiveProfile.selectedProfile}`;
  }

  if (requestedProfile.selectedProfile === effectiveProfile.selectedProfile) {
    return `effective review remained ${effectiveProfile.selectedProfile}`;
  }

  return `effective review was ${effectiveProfile.selectedProfile}`;
}

function buildLargePRClause(largePR: ReviewBoundednessLargePR): string {
  return `covered ${largePR.reviewedCount}/${largePR.totalFiles} changed files via large-PR triage (${largePR.fullCount} full, ${largePR.abbreviatedCount} abbreviated; ${largePR.notReviewedCount} not reviewed)`;
}

function buildDisclosureSentence(params: {
  requestedProfile: ResolvedReviewProfile;
  effectiveProfile: ResolvedReviewProfile;
  largePR: ReviewBoundednessLargePR | null;
  timeout: ReviewBoundednessTimeout | null;
  disclosureRequired: boolean;
}): string | null {
  const { requestedProfile, effectiveProfile, largePR, timeout, disclosureRequired } = params;
  if (!disclosureRequired) {
    return null;
  }

  const prefix = buildRequestedProfilePrefix(requestedProfile);
  const effectiveClause = buildEffectiveProfileClause({
    requestedProfile,
    effectiveProfile,
    timeout,
  });

  if (largePR) {
    return `${prefix}; ${effectiveClause} and ${buildLargePRClause(largePR)}.`;
  }

  return `${prefix}; ${effectiveClause}.`;
}

function hasLargePRBoundedness(largePR: ReviewBoundednessLargePR | null): boolean {
  if (!largePR) {
    return false;
  }

  return largePR.abbreviatedCount > 0 || largePR.notReviewedCount > 0;
}

export function resolveReviewBoundedness(params: {
  requestedProfile: ResolvedReviewProfile | null | undefined;
  effectiveProfile: ResolvedReviewProfile | null | undefined;
  largePRTriage?: {
    fullCount: number;
    abbreviatedCount: number;
    totalFiles: number;
  } | null;
  timeout?: {
    riskLevel: TimeoutRiskLevel;
    dynamicTimeoutSeconds: number;
    shouldReduceScope: boolean;
    reductionApplied: boolean;
    reductionSkippedReason: "explicit-profile" | "config-disabled" | null;
  } | null;
}): ReviewBoundednessContract | null {
  const requestedProfile = isResolvedReviewProfile(params.requestedProfile)
    ? params.requestedProfile
    : null;
  const effectiveProfile = isResolvedReviewProfile(params.effectiveProfile)
    ? params.effectiveProfile
    : null;

  if (!requestedProfile || !effectiveProfile) {
    return null;
  }

  const largePR = normalizeLargePR(params.largePRTriage);
  const timeout = normalizeTimeout(params.timeout);
  const reasonCodes: ReviewBoundednessReasonCode[] = [];

  if (hasLargePRBoundedness(largePR)) {
    reasonCodes.push("large-pr-triage");
  }

  if (timeout?.reductionApplied) {
    reasonCodes.push("timeout-auto-reduced");
  } else if (timeout?.shouldReduceScope && timeout.reductionSkippedReason === "explicit-profile") {
    reasonCodes.push("timeout-auto-reduction-skipped-explicit-profile");
  } else if (timeout?.shouldReduceScope && timeout.reductionSkippedReason === "config-disabled") {
    reasonCodes.push("timeout-auto-reduction-skipped-config-disabled");
  }

  const disclosureRequired = Boolean(
    hasLargePRBoundedness(largePR) || timeout?.reductionApplied,
  );

  return {
    requestedProfile,
    effectiveProfile,
    reasonCodes,
    disclosureRequired,
    disclosureSentence: buildDisclosureSentence({
      requestedProfile,
      effectiveProfile,
      largePR: hasLargePRBoundedness(largePR) ? largePR : null,
      timeout,
      disclosureRequired,
    }),
    largePR: largePR && hasLargePRBoundedness(largePR) ? largePR : null,
    timeout,
  };
}

export function ensureReviewBoundednessDisclosureInSummary(
  summaryBody: string,
  contract: ReviewBoundednessContract | null | undefined,
): string {
  const disclosureSentence = contract?.disclosureSentence;
  if (!contract?.disclosureRequired || !disclosureSentence) {
    return summaryBody;
  }

  if (summaryBody.includes(disclosureSentence)) {
    return summaryBody;
  }

  const lines = summaryBody.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === "## What Changed");
  if (headingIndex === -1) {
    return summaryBody;
  }

  const nextHeadingIndex = lines.findIndex(
    (line, index) => index > headingIndex && /^##\s+/.test(line.trim()),
  );
  const sectionEndIndex = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;

  let insertionIndex = sectionEndIndex;
  while (insertionIndex > headingIndex + 1 && lines[insertionIndex - 1]?.trim() === "") {
    insertionIndex -= 1;
  }

  lines.splice(insertionIndex, 0, `- ${disclosureSentence}`, "");
  return lines.join("\n");
}
