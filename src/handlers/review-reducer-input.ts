import type { EmbeddingProvider } from "../knowledge/types.ts";
import type { SuggestionClusterStore } from "../knowledge/suggestion-cluster-store.ts";
import type { ExtractedFinding } from "../review-orchestration/review-comment-finding-extraction.ts";
import {
  detectCommentSlopInDiff,
  toCommentSlopReducerFindings,
} from "../review-orchestration/comment-slop-detector.ts";
import {
  toReviewCandidateReducerDrafts,
} from "../review-orchestration/review-candidate-finding-handler.ts";
import type { ReviewCandidateFindingExecutionResult } from "../review-orchestration/review-candidate-finding.ts";
import type {
  ProcessedReviewFinding,
  ReviewReducerInput,
} from "../review-orchestration/review-reducer.ts";

export function buildReviewReducerInput(params: {
  extractedFindings: readonly ExtractedFinding[];
  reviewCandidateFindingResult: ReviewCandidateFindingExecutionResult;
  workspaceDir: string;
  filesByCategory: ReviewReducerInput["filesByCategory"] | undefined;
  filesByLanguage: ReviewReducerInput["filesByLanguage"] | undefined;
  languageRules: ReviewReducerInput["languageRules"];
  reviewSuppressions: ReviewReducerInput["reviewSuppressions"];
  minConfidence: number;
  prioritizationWeights: ReviewReducerInput["prioritizationWeights"];
  feedbackSuppression: ReviewReducerInput["feedbackSuppression"];
  priorFindingContext: ReviewReducerInput["priorFindingContext"];
  diffContent: string | null | undefined;
  prBody: string | null;
  commitMessages: string[];
  tieredFiles: ReviewReducerInput["tieredFiles"];
  graphBlastRadius: ReviewReducerInput["graphBlastRadius"];
  graphValidationEnabled: boolean;
  riskScores: ReviewReducerInput["riskScores"];
  resolvedMaxComments: number | undefined;
  logger: ReviewReducerInput["logger"];
  baseLog: Record<string, unknown>;
  repo: string;
  clusterModelStore: SuggestionClusterStore | null | undefined;
  embeddingProvider: EmbeddingProvider | null | undefined;
  guardrailAuditStore: ReviewReducerInput["guardrailAuditStore"];
  guardrailStrictness: ReviewReducerInput["guardrailStrictness"];
  graphValidationLLM: ReviewReducerInput["graphValidationLLM"];
  repoDoctrine: ReviewReducerInput["repoDoctrine"];
}): ReviewReducerInput {
  const commentSlopFindings = toCommentSlopReducerFindings(
    detectCommentSlopInDiff(params.diffContent ?? ""),
  );
  const candidateReducerFindings = toReviewCandidateReducerDrafts(params.reviewCandidateFindingResult);

  return {
    findings: [
      ...(params.extractedFindings as unknown as ProcessedReviewFinding[]),
      ...commentSlopFindings,
      ...candidateReducerFindings,
    ],
    workspaceDir: params.workspaceDir,
    filesByCategory: params.filesByCategory ?? {},
    filesByLanguage: params.filesByLanguage ?? {},
    languageRules: params.languageRules,
    reviewSuppressions: params.reviewSuppressions,
    minConfidence: params.minConfidence,
    prioritizationWeights: params.prioritizationWeights,
    feedbackSuppression: params.feedbackSuppression,
    priorFindingContext: params.priorFindingContext,
    diffContent: params.diffContent,
    prBody: params.prBody,
    commitMessages: params.commitMessages,
    tieredFiles: params.tieredFiles,
    graphBlastRadius: params.graphBlastRadius,
    graphValidationEnabled: params.graphValidationEnabled,
    riskScores: params.riskScores,
    resolvedMaxComments: params.resolvedMaxComments,
    logger: params.logger,
    baseLog: params.baseLog,
    repo: params.repo,
    clusterModelStore: params.clusterModelStore ?? null,
    embeddingProvider: params.embeddingProvider ?? null,
    guardrailAuditStore: params.guardrailAuditStore,
    guardrailStrictness: params.guardrailStrictness,
    graphValidationLLM: params.graphValidationLLM,
    repoDoctrine: params.repoDoctrine,
  };
}
