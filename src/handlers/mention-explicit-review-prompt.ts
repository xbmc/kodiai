import type { Logger } from "pino";
import type { RepoConfig } from "../execution/config.ts";
import { buildPrDiffCommentabilityIndex, type PrDiffCommentabilityIndex } from "../execution/formatter-suggestions.ts";
import { buildPromptSectionRecord } from "../execution/prompt-section-metrics.ts";
import { buildReviewPromptDetails, matchPathInstructions } from "../execution/review-prompt.ts";
import { analyzeDiff, parseNumstatPerFile } from "../execution/diff-analysis.ts";
import { computeFileRiskScores, triageFilesByRisk } from "../lib/file-risk-scorer.ts";
import {
  resolveReviewMaxTurnsOverride,
  resolveReviewRoutingLineCount,
  resolveReviewTaskRouting,
  type ReviewTaskRouting,
} from "../lib/review-routing.ts";
import { computeLanguageComplexity, estimateTimeoutRisk } from "../lib/timeout-estimator.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import type { ReviewCommentMatch } from "../knowledge/review-comment-retrieval.ts";
import type { UnifiedRetrievalChunk } from "../knowledge/cross-corpus-rrf.ts";
import type { WikiKnowledgeMatch } from "../knowledge/wiki-retrieval.ts";
import { toProductionLogTurnBudgetFields } from "../review-audit/production-log-projection.ts";
import type { PromptSectionRecord } from "../telemetry/types.ts";
import type { MentionRetrievalContext } from "./mention-retrieval-context.ts";
import { collectPrReviewPromptDiff } from "./mention-pr-review-diff.ts";
import { selectExplicitReviewPromptDiffContent } from "./mention-token-budget.ts";
import type { MentionEvent } from "./mention-types.ts";

type PullRequestLabel = string | { name?: string | null };

type ExplicitReviewPullRequest = {
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
  title: string;
  body?: string | null;
  user?: { login?: string | null } | null;
  additions?: number | null;
  deletions?: number | null;
  labels?: PullRequestLabel[] | null;
  draft?: boolean | null;
};

type PromptDiffContext = Awaited<ReturnType<typeof collectPrReviewPromptDiff>>;

export type MentionExplicitReviewPromptResult = {
  prompt: string;
  promptSections: PromptSectionRecord[];
  promptFileCount: number;
  dynamicTimeoutSeconds: number | undefined;
  maxTurnsOverride: number | undefined;
  prDiffCommentabilityIndex: PrDiffCommentabilityIndex | undefined;
  headSha: string;
  baseSha: string;
  routing: ReviewTaskRouting;
};

export async function buildMentionExplicitReviewPrompt(params: {
  mention: MentionEvent & { prNumber: number };
  config: Pick<RepoConfig, "maxTurns" | "timeoutSeconds" | "timeout" | "largePR" | "review">;
  deliveryId: string;
  workspaceDir: string;
  workspaceToken?: string;
  retrievalContext: MentionRetrievalContext | undefined;
  reviewPrecedents: ReviewCommentMatch[];
  wikiKnowledge: WikiKnowledgeMatch[];
  unifiedResults: UnifiedRetrievalChunk[];
  contextWindow: string | undefined;
  logger: Logger;
  getPullRequest: (params: {
    owner: string;
    repo: string;
    pull_number: number;
  }) => Promise<ExplicitReviewPullRequest>;
  collectPromptDiff?: (params: Parameters<typeof collectPrReviewPromptDiff>[0]) => Promise<PromptDiffContext>;
  fetchPullRequestFiles?: (params: {
    owner: string;
    repo: string;
    pullNumber: number;
  }) => Promise<Array<{
    filename: string;
    status?: string;
    previousFilename?: string;
    additions?: number | null;
    deletions?: number | null;
    patch?: string | null;
  }>>;
}): Promise<MentionExplicitReviewPromptResult> {
  const {
    mention,
    config,
    deliveryId,
    workspaceDir,
    workspaceToken,
    retrievalContext,
    reviewPrecedents,
    wikiKnowledge,
    unifiedResults,
    contextWindow,
    logger,
    getPullRequest,
    collectPromptDiff = collectPrReviewPromptDiff,
    fetchPullRequestFiles: fetchPullRequestFilesForPrompt,
  } = params;

  const explicitReviewPrNumber = mention.prNumber;
  const explicitReviewPr = await getPullRequest({
    owner: mention.owner,
    repo: mention.repo,
    pull_number: explicitReviewPrNumber,
  });

  const promptDiffContext = mention.baseRef
    ? await collectPromptDiff({
        workspaceDir,
        owner: mention.owner,
        repo: mention.repo,
        prNumber: explicitReviewPrNumber,
        baseRef: mention.baseRef,
        surface: mention.surface,
        logger,
        token: workspaceToken,
        fallbackDiffProvider: fetchPullRequestFilesForPrompt
          ? async () => await fetchPullRequestFilesForPrompt({
              owner: mention.owner,
              repo: mention.repo,
              pullNumber: explicitReviewPrNumber,
            })
          : undefined,
      })
    : { changedFiles: [], numstatLines: [], diffRange: "unknown" };

  const promptChangedFiles = promptDiffContext.changedFiles;
  const prDiffCommentabilityIndex = promptDiffContext.diffContent
    ? buildPrDiffCommentabilityIndex(promptDiffContext.diffContent)
    : undefined;
  const promptFileCount = promptChangedFiles.length;
  const explicitReviewPromptDiffContent = selectExplicitReviewPromptDiffContent({
    diffContent: promptDiffContext.diffContent,
    changedFileCount: promptChangedFiles.length,
  });

  const diffAnalysis = analyzeDiff({
    changedFiles: promptChangedFiles,
    numstatLines: promptDiffContext.numstatLines,
    fileCategories: config.review.fileCategories as Record<string, string[]> | undefined,
  });
  const diffAnalysisLinesChanged = (diffAnalysis.metrics.totalLinesAdded ?? 0) +
    (diffAnalysis.metrics.totalLinesRemoved ?? 0);
  const prApiLinesChanged = (explicitReviewPr.additions ?? 0) + (explicitReviewPr.deletions ?? 0);
  const explicitReviewLinesChanged = resolveReviewRoutingLineCount({
    diffLinesChanged: diffAnalysisLinesChanged,
    prApiLinesChanged,
  });
  const routing = resolveReviewTaskRouting({
    changedFileCount: promptChangedFiles.length,
    linesChanged: explicitReviewLinesChanged,
  });
  const languageComplexity = computeLanguageComplexity(diffAnalysis.filesByLanguage);
  const timeoutEstimate = estimateTimeoutRisk({
    fileCount: promptChangedFiles.length,
    linesChanged: explicitReviewLinesChanged,
    languageComplexity,
    isLargePR: diffAnalysis.isLargePR,
    baseTimeoutSeconds: config.timeoutSeconds,
  });
  const dynamicTimeoutSeconds = config.timeout.dynamicScaling !== false
    ? timeoutEstimate.totalTimeoutSeconds
    : undefined;
  const maxTurnsOverride = resolveReviewMaxTurnsOverride({
    taskType: routing.taskType,
    routingMaxTurnsOverride: routing.maxTurnsOverride,
    timeoutRiskLevel: timeoutEstimate.riskLevel,
    baseMaxTurns: config.maxTurns,
    changedFiles: promptChangedFiles,
  });

  logger.info(
    {
      surface: mention.surface,
      owner: mention.owner,
      repo: mention.repo,
      prNumber: mention.prNumber,
      gate: "review-routing",
      taskType: routing.taskType,
      routingReason: routing.routingReason,
      changedFiles: promptChangedFiles.length,
      linesChanged: explicitReviewLinesChanged,
      ...toProductionLogTurnBudgetFields(
        maxTurnsOverride,
        maxTurnsOverride !== undefined ? "dynamic-risk" : "config",
      ),
      timeoutSeconds: dynamicTimeoutSeconds ?? null,
      timeoutRiskLevel: timeoutEstimate.riskLevel,
      remoteRuntimeBudgetSeconds: timeoutEstimate.remoteRuntimeBudgetSeconds,
      infraOverheadBudgetSeconds: timeoutEstimate.infraOverheadBudgetSeconds,
      lane: "interactive-review",
    },
    "Mention review routing decision",
  );

  const matchedPathInstructions = matchPathInstructions(
    config.review.pathInstructions,
    promptChangedFiles,
  );
  const perFileStats = parseNumstatPerFile(promptDiffContext.numstatLines);
  const riskScores = computeFileRiskScores({
    files: promptChangedFiles,
    perFileStats,
    filesByCategory: diffAnalysis.filesByCategory,
    weights: config.largePR.riskWeights,
  });
  const tieredFiles = triageFilesByRisk({
    riskScores,
    fileThreshold: config.largePR.fileThreshold,
    fullReviewCount: config.largePR.fullReviewCount,
    abbreviatedCount: config.largePR.abbreviatedCount,
    totalFileCount: promptChangedFiles.length,
  });
  const promptFiles = tieredFiles.isLargePR
    ? [
        ...tieredFiles.full.map((file) => file.filePath),
        ...tieredFiles.abbreviated.map((file) => file.filePath),
      ]
    : promptChangedFiles;

  const prLabels = (explicitReviewPr.labels ?? [])
    .map((label) => typeof label === "string" ? label : label.name)
    .filter((label): label is string => typeof label === "string" && label.length > 0);

  const reviewPromptResult = buildReviewPromptDetails({
    owner: mention.owner,
    repo: mention.repo,
    prNumber: mention.prNumber,
    prTitle: explicitReviewPr.title,
    prBody: explicitReviewPr.body ?? "",
    prAuthor: explicitReviewPr.user?.login ?? "unknown",
    baseBranch: explicitReviewPr.base.ref,
    headBranch: explicitReviewPr.head.ref,
    changedFiles: promptFiles,
    customInstructions: config.review.prompt,
    mode: config.review.mode,
    severityMinLevel: config.review.severity.minLevel,
    focusAreas: config.review.focusAreas,
    ignoredAreas: config.review.ignoredAreas,
    maxComments: config.review.maxComments,
    suppressions: config.review.suppressions,
    minConfidence: config.review.minConfidence,
    diffAnalysis,
    diffContent: explicitReviewPromptDiffContent,
    matchedPathInstructions,
    retrievalContext,
    reviewPrecedents: reviewPrecedents.length > 0 ? reviewPrecedents : undefined,
    wikiKnowledge: wikiKnowledge.length > 0 ? wikiKnowledge : undefined,
    unifiedResults: unifiedResults.length > 0 ? unifiedResults : undefined,
    contextWindow,
    filesByLanguage: diffAnalysis.filesByLanguage,
    outputLanguage: config.review.outputLanguage,
    prLabels,
    isDraft: Boolean(explicitReviewPr.draft),
    smallDiffReview: routing.taskType === TASK_TYPES.REVIEW_SMALL_DIFF,
    largePRContext: tieredFiles.isLargePR ? {
      fullReviewFiles: tieredFiles.full.map((file) => file.filePath),
      abbreviatedFiles: tieredFiles.abbreviated.map((file) => file.filePath),
      mentionOnlyCount: tieredFiles.mentionOnly.length,
      totalFiles: tieredFiles.totalFiles,
    } : null,
    gitDiffInstructionsAvailable: false,
    publishToolNames: [
      "mcp__github_comment__create_comment",
      "mcp__github_inline_comment__create_inline_comment",
    ],
    candidateFindingToolName: "record_candidate_finding",
    candidateFindingMode: "preferred",
  });

  return {
    prompt: reviewPromptResult.text,
    promptSections: [
      buildPromptSectionRecord({
        deliveryId,
        repo: `${mention.owner}/${mention.repo}`,
        taskType: routing.taskType,
        promptKind: "review.user-prompt",
        sections: reviewPromptResult.sections,
      }),
    ],
    promptFileCount,
    dynamicTimeoutSeconds,
    maxTurnsOverride,
    prDiffCommentabilityIndex,
    headSha: explicitReviewPr.head.sha,
    baseSha: explicitReviewPr.base.sha,
    routing,
  };
}
