import { createHash } from "node:crypto";
import { buildReviewPromptDetails } from "../execution/review-prompt.ts";

export type ReviewPromptBuildContext = Parameters<typeof buildReviewPromptDetails>[0];

export type ReviewPromptFingerprintResult = {
  fingerprint: string | null;
  missingSignals: string[];
};

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hashPromptString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return sha256Hex(value);
}


function normalizePromptStringList(values: string[] | undefined, signal: string): { values: string[] | null; missingSignals: string[] } {
  if (!values) {
    return { values: [], missingSignals: [] };
  }

  const normalized = values
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter((value) => value.length > 0);

  if (values.length > 0 && normalized.length !== values.length) {
    return { values: null, missingSignals: [signal] };
  }

  return {
    values: Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b)),
    missingSignals: [],
  };
}

function summarizeRetrievalContextFingerprint(
  retrievalContext: ReviewPromptBuildContext["retrievalContext"],
): { value: Record<string, unknown> | null; missingSignals: string[] } {
  if (!retrievalContext) {
    return { value: null, missingSignals: [] };
  }

  const summarizedFindings: Array<Record<string, unknown>> = [];
  for (const finding of retrievalContext.findings) {
    if (
      typeof finding.findingText !== "string"
      || typeof finding.severity !== "string"
      || typeof finding.category !== "string"
      || typeof finding.path !== "string"
      || typeof finding.outcome !== "string"
      || typeof finding.sourceRepo !== "string"
      || !Number.isFinite(finding.distance)
    ) {
      return { value: null, missingSignals: ["retrieval-fingerprint-data"] };
    }

    summarizedFindings.push({
      findingTextHash: sha256Hex(finding.findingText),
      severity: finding.severity,
      category: finding.category,
      path: finding.path,
      line: finding.line ?? null,
      snippetHash: hashPromptString(finding.snippet),
      outcome: finding.outcome,
      distance: Number(finding.distance.toFixed(6)),
      sourceRepo: finding.sourceRepo.toLowerCase(),
    });
  }

  return {
    value: {
      maxChars: retrievalContext.maxChars ?? null,
      findings: summarizedFindings,
    },
    missingSignals: [],
  };
}

export function buildReviewPromptFingerprint(
  context: ReviewPromptBuildContext,
): ReviewPromptFingerprintResult {
  const missingSignals: string[] = [];

  const owner = context.owner.trim().toLowerCase();
  const repo = context.repo.trim().toLowerCase();
  const baseBranch = context.baseBranch.trim();
  const headBranch = context.headBranch.trim();
  const prAuthor = context.prAuthor.trim();
  const normalizedChangedFiles = normalizePromptStringList(context.changedFiles, "changed-files");
  const focusAreas = normalizePromptStringList(context.focusAreas, "focus-areas");
  const ignoredAreas = normalizePromptStringList(context.ignoredAreas, "ignored-areas");
  const prLabels = normalizePromptStringList(context.prLabels, "pr-labels");
  const focusHints = normalizePromptStringList(context.focusHints, "focus-hints");
  const retrievalSummary = summarizeRetrievalContextFingerprint(context.retrievalContext);

  missingSignals.push(...normalizedChangedFiles.missingSignals, ...focusAreas.missingSignals, ...ignoredAreas.missingSignals, ...prLabels.missingSignals, ...focusHints.missingSignals, ...retrievalSummary.missingSignals);

  if (!owner || !repo) missingSignals.push("repo-identity");
  if (!Number.isInteger(context.prNumber) || context.prNumber <= 0) missingSignals.push("pr-number");
  if (!baseBranch || !headBranch) missingSignals.push("pr-refs");
  if (normalizedChangedFiles.values !== null && normalizedChangedFiles.values.length === 0) missingSignals.push("changed-files");
  if (typeof context.prTitle !== "string") missingSignals.push("pr-title");
  if (!prAuthor) missingSignals.push("pr-author");

  if (missingSignals.length > 0) {
    return { fingerprint: null, missingSignals: Array.from(new Set(missingSignals)) };
  }

  const fingerprintPayload = {
    version: 1,
    repo: `${owner}/${repo}`,
    prNumber: context.prNumber,
    prTitleHash: sha256Hex(context.prTitle),
    prBodyHash: hashPromptString(context.prBody),
    prAuthor,
    baseBranch,
    headBranch,
    changedFiles: normalizedChangedFiles.values,
    customInstructionsHash: hashPromptString(context.customInstructions),
    checkpointEnabled: context.checkpointEnabled ?? false,
    mode: context.mode ?? "standard",
    severityMinLevel: context.severityMinLevel ?? "minor",
    focusAreas: focusAreas.values,
    ignoredAreas: ignoredAreas.values,
    maxComments: context.maxComments ?? null,
    suppressionsHash: hashPromptString(JSON.stringify(context.suppressions ?? [])),
    minConfidence: context.minConfidence ?? null,
    diffAnalysisHash: hashPromptString(JSON.stringify(context.diffAnalysis ?? null)),
    matchedPathInstructionsHash: hashPromptString(JSON.stringify(context.matchedPathInstructions ?? [])),
    incrementalContextHash: hashPromptString(JSON.stringify(context.incrementalContext ?? null)),
    retrievalContext: retrievalSummary.value,
    reviewPrecedentsHash: hashPromptString(JSON.stringify(context.reviewPrecedents ?? [])),
    wikiKnowledgeHash: hashPromptString(JSON.stringify(context.wikiKnowledge ?? [])),
    filesByLanguageHash: hashPromptString(JSON.stringify(context.filesByLanguage ?? null)),
    outputLanguage: context.outputLanguage ?? null,
    prLabels: prLabels.values,
    focusHints: focusHints.values,
    conventionalTypeHash: hashPromptString(JSON.stringify(context.conventionalType ?? null)),
    deltaContextHash: hashPromptString(JSON.stringify(context.deltaContext ?? null)),
    largePRContextHash: hashPromptString(JSON.stringify(context.largePRContext ?? null)),
    authorTier: context.authorTier ?? null,
    contributorExperienceContractHash: hashPromptString(JSON.stringify(context.contributorExperienceContract ?? null)),
    authorExpertiseHash: hashPromptString(JSON.stringify(context.authorExpertise ?? [])),
    depBumpContextHash: hashPromptString(JSON.stringify(context.depBumpContext ?? null)),
    searchRateLimitDegradationHash: hashPromptString(JSON.stringify(context.searchRateLimitDegradation ?? null)),
    isDraft: context.isDraft ?? false,
    unifiedResultsHash: hashPromptString(JSON.stringify(context.unifiedResults ?? [])),
    contextWindowHash: hashPromptString(context.contextWindow),
    clusterPatternsHash: hashPromptString(JSON.stringify(context.clusterPatterns ?? [])),
    linkedIssuesHash: hashPromptString(JSON.stringify(context.linkedIssues ?? null)),
    activeRulesHash: hashPromptString(JSON.stringify(context.activeRules ?? [])),
    graphBlastRadiusHash: hashPromptString(JSON.stringify(context.graphBlastRadius ?? null)),
    graphContextOptionsHash: hashPromptString(JSON.stringify(context.graphContextOptions ?? null)),
    structuralImpactHash: hashPromptString(JSON.stringify(context.structuralImpact ?? null)),
    reviewBoundednessHash: hashPromptString(JSON.stringify(context.reviewBoundedness ?? null)),
    publishToolNamesHash: hashPromptString(JSON.stringify(context.publishToolNames ?? [])),
    candidateFindingToolName: context.candidateFindingToolName ?? null,
    candidateFindingMode: context.candidateFindingMode ?? null,
  };

  return {
    fingerprint: sha256Hex(JSON.stringify(fingerprintPayload)),
    missingSignals: [],
  };
}