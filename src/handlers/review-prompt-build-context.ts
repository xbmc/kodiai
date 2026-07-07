import type { DiffAnalysis } from "../execution/diff-analysis.ts";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import type { TieredFiles } from "../lib/file-risk-scorer.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import type { PriorFinding } from "../knowledge/types.ts";
import type { ReviewPromptBuildContext } from "../review-orchestration/review-prompt-fingerprint.ts";

type PriorFindingContextForPrompt = {
  unresolvedOnUnchangedCode?: NonNullable<ReviewPromptBuildContext["incrementalContext"]>["unresolvedPriorFindings"];
} | null;

export function buildInitialReviewPromptContext(params: {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  prAuthor: string;
  baseBranch: string;
  headBranch: string;
  changedFiles: string[];
  customInstructions?: string;
  checkpointEnabled: boolean;
  mode: ReviewPromptBuildContext["mode"];
  severityMinLevel: ReviewPromptBuildContext["severityMinLevel"];
  focusAreas: string[];
  ignoredAreas: string[];
  maxComments: number;
  suppressions: NonNullable<ReviewPromptBuildContext["suppressions"]>;
  minConfidence: number;
  diffAnalysis: DiffAnalysis;
  diffContent: string | undefined;
  matchedPathInstructions: NonNullable<ReviewPromptBuildContext["matchedPathInstructions"]>;
  incrementalResult: IncrementalDiffResult | null;
  priorFindingContext: PriorFindingContextForPrompt;
  retrievalContext: ReviewPromptBuildContext["retrievalContext"];
  reviewPrecedents: NonNullable<ReviewPromptBuildContext["reviewPrecedents"]>;
  wikiKnowledge: NonNullable<ReviewPromptBuildContext["wikiKnowledge"]>;
  unifiedResults: NonNullable<ReviewPromptBuildContext["unifiedResults"]>;
  contextWindow: string | undefined;
  outputLanguage: string | undefined;
  prLabels: string[];
  focusHints: string[];
  conventionalType: ReviewPromptBuildContext["conventionalType"];
  priorFindings: PriorFinding[];
  tieredFiles: TieredFiles;
  contributorExperienceContract: ReviewPromptBuildContext["contributorExperienceContract"];
  authorExpertise: ReviewPromptBuildContext["authorExpertise"];
  depBumpContext: ReviewPromptBuildContext["depBumpContext"];
  searchRateLimitDegradation: ReviewPromptBuildContext["searchRateLimitDegradation"];
  isDraft: boolean;
  clusterPatterns: NonNullable<ReviewPromptBuildContext["clusterPatterns"]>;
  linkedIssues: ReviewPromptBuildContext["linkedIssues"];
  graphBlastRadius: ReviewPromptBuildContext["graphBlastRadius"];
  structuralImpact: ReviewPromptBuildContext["structuralImpact"];
  reviewBoundedness: ReviewPromptBuildContext["reviewBoundedness"];
  repoDoctrine: ReviewPromptBuildContext["repoDoctrine"];
  taskType: string;
}): ReviewPromptBuildContext {
  return {
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    prTitle: params.prTitle,
    prBody: params.prBody,
    prAuthor: params.prAuthor,
    baseBranch: params.baseBranch,
    headBranch: params.headBranch,
    changedFiles: params.changedFiles,
    customInstructions: params.customInstructions,
    checkpointEnabled: params.checkpointEnabled,
    mode: params.mode,
    severityMinLevel: params.severityMinLevel,
    focusAreas: params.focusAreas,
    ignoredAreas: params.ignoredAreas,
    maxComments: params.maxComments,
    suppressions: params.suppressions,
    minConfidence: params.minConfidence,
    diffAnalysis: params.diffAnalysis,
    diffContent: params.diffContent,
    matchedPathInstructions: params.matchedPathInstructions,
    incrementalContext: params.incrementalResult?.mode === "incremental" ? {
      lastReviewedHeadSha: params.incrementalResult.lastReviewedHeadSha!,
      changedFilesSinceLastReview: params.incrementalResult.changedFilesSinceLastReview,
      unresolvedPriorFindings: params.priorFindingContext?.unresolvedOnUnchangedCode ?? [],
    } : null,
    retrievalContext: params.retrievalContext,
    reviewPrecedents: params.reviewPrecedents.length > 0 ? params.reviewPrecedents : undefined,
    wikiKnowledge: params.wikiKnowledge.length > 0 ? params.wikiKnowledge : undefined,
    unifiedResults: params.unifiedResults.length > 0 ? params.unifiedResults : undefined,
    contextWindow: params.contextWindow,
    filesByLanguage: params.diffAnalysis.filesByLanguage,
    outputLanguage: params.outputLanguage,
    prLabels: params.prLabels,
    focusHints: params.focusHints,
    conventionalType: params.conventionalType,
    deltaContext: params.incrementalResult?.mode === "incremental" && params.priorFindings.length > 0
      ? {
          lastReviewedHeadSha: params.incrementalResult.lastReviewedHeadSha!,
          changedFilesSinceLastReview: params.incrementalResult.changedFilesSinceLastReview,
          priorFindings: params.priorFindings.map(finding => ({
            filePath: finding.filePath,
            title: finding.title,
            severity: finding.severity,
            category: finding.category,
          })),
        }
      : null,
    largePRContext: params.tieredFiles.isLargePR ? {
      fullReviewFiles: params.tieredFiles.full.map(file => file.filePath),
      abbreviatedFiles: params.tieredFiles.abbreviated.map(file => file.filePath),
      mentionOnlyCount: params.tieredFiles.mentionOnly.length,
      totalFiles: params.tieredFiles.totalFiles,
    } : null,
    gitDiffInstructionsAvailable: false,
    publishToolNames: [
      "mcp__github_comment__create_comment",
      "mcp__github_inline_comment__create_inline_comment",
    ],
    candidateFindingToolName: "record_candidate_finding",
    candidateFindingMode: "preferred",
    contributorExperienceContract: params.contributorExperienceContract,
    authorExpertise: params.authorExpertise,
    depBumpContext: params.depBumpContext,
    searchRateLimitDegradation: params.searchRateLimitDegradation,
    isDraft: params.isDraft,
    clusterPatterns: params.clusterPatterns.length > 0 ? params.clusterPatterns : undefined,
    linkedIssues: params.linkedIssues,
    graphBlastRadius: params.graphBlastRadius ?? undefined,
    structuralImpact: params.structuralImpact,
    reviewBoundedness: params.reviewBoundedness,
    repoDoctrine: params.repoDoctrine,
    smallDiffReview: params.taskType === TASK_TYPES.REVIEW_SMALL_DIFF,
  };
}
