import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { RepoConfig } from "../execution/config.ts";
import type { DiffAnalysis } from "../execution/diff-analysis.ts";
import type { PrDiffCommentabilityIndex } from "../execution/formatter-suggestions.ts";
import type { FeedbackSuppressionResult } from "../feedback/index.ts";
import type { GuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import type { EmbeddingProvider, KnowledgeStore } from "../knowledge/types.ts";
import type { SuggestionClusterStore } from "../knowledge/suggestion-cluster-store.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import type { RepoDoctrineReviewSurfaceProjection } from "../review-orchestration/review-plan-doctrine-log.ts";
import type {
  ReviewReducerInput,
  ReviewReducerResult,
} from "../review-orchestration/review-reducer.ts";
import type { CandidateVerificationContext } from "../execution/mcp/review-output-publication-gate.ts";
import type { CandidateVerificationPublicationEvidenceSummary } from "../specialists/candidate-verification-publication-evidence.ts";
import type {
  ReviewCandidateApprovalResult,
} from "../review-orchestration/review-candidate-approval.ts";
import type {
  ReviewCandidatePublicationAdapterResult,
} from "../review-orchestration/review-candidate-publication-adapter.ts";
import type { InlineReviewPublicationResult } from "../execution/mcp/inline-review-publisher.ts";
import type { ReviewCandidateFindingContext } from "./review-candidate-finding-context.ts";
import type { ReviewReducerRuntime } from "./review-reducer-runtime.ts";
import { resolveReviewCandidateFindingContext } from "./review-candidate-finding-context.ts";
import { resolveReviewFeedbackSuppression } from "./review-feedback-suppression.ts";
import { resolveReviewGraphValidationLLM } from "./review-graph-validation-llm.ts";
import { buildReviewReducerInput } from "./review-reducer-input.ts";
import { runReviewReducerFailOpen } from "./review-reducer-runtime.ts";
import { resolveReviewCandidateApprovalContext } from "./review-candidate-approval-context.ts";
import { publishReviewCandidateInlineComments } from "./review-candidate-inline-publication.ts";

export type ReviewCandidatePublicationPreparationResult = {
  extractionOctokit: Octokit;
  reviewCandidateFindingResult: ReviewCandidateFindingContext["result"];
  reviewCandidateFindingDetailsSummary: ReviewCandidateFindingContext["detailsSummary"];
  reviewCandidateFindingConfigSnapshot: ReviewCandidateFindingContext["configSnapshot"];
  extractedFindings: ReviewCandidateFindingContext["extractedFindings"];
  feedbackSuppression: FeedbackSuppressionResult;
  reducerResult: ReviewReducerResult;
  directFallbackAllowed: boolean;
  directPublicationAttempted: boolean;
  reviewCandidateApprovalResult: ReviewCandidateApprovalResult;
  reviewCandidatePublicationAdapter: ReviewCandidatePublicationAdapterResult;
  candidatePublisherResults: Map<string, InlineReviewPublicationResult>;
  reviewCandidateVerificationPublicationEvidence?: CandidateVerificationPublicationEvidenceSummary;
};

export function buildReviewCandidatePublicationPreparationAdapters(params: {
  installationId: number;
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
  appSlug: string;
}): Pick<Parameters<typeof resolveReviewCandidatePublicationPreparation>[0], "getOctokit" | "appSlug"> {
  return {
    getOctokit: () => params.getInstallationOctokit(params.installationId),
    appSlug: params.appSlug,
  };
}

export async function resolveReviewCandidatePublicationPreparation(params: {
  getOctokit: () => Promise<Octokit>;
  candidateFinding: unknown;
  reviewOutputSucceeded: boolean;
  resultPublished: boolean;
  initialCandidateVerificationPublicationEvidence?: CandidateVerificationPublicationEvidenceSummary;
  logger: Logger;
  baseLog: Record<string, unknown>;
  owner: string;
  repo: string;
  pr: {
    number: number;
    body?: string | null;
  };
  deliveryId: string;
  reviewOutputKey: string;
  knowledgeStore?: KnowledgeStore;
  config: Pick<RepoConfig, "feedback" | "review" | "languageRules" | "guardrails">;
  workspaceDir: string;
  diffAnalysis: Pick<DiffAnalysis, "filesByCategory" | "filesByLanguage">;
  diffContent: string | null | undefined;
  commitMessages: string[];
  tieredFiles: ReviewReducerInput["tieredFiles"];
  graphBlastRadius: ReviewGraphBlastRadiusResult | null;
  riskScores: ReviewReducerInput["riskScores"];
  resolvedMaxComments: number;
  priorFindingContext: ReviewReducerInput["priorFindingContext"];
  clusterModelStore?: SuggestionClusterStore | null;
  embeddingProvider?: EmbeddingProvider | null;
  guardrailAuditStore?: GuardrailAuditStore;
  repoDoctrineReviewSurface: RepoDoctrineReviewSurfaceProjection;
  reviewReducer: ReviewReducerRuntime;
  canPublishVisibleOutput: (label: string) => boolean;
  appSlug: string;
  candidateVerificationContext?: CandidateVerificationContext;
  prDiffCommentabilityIndex?: PrDiffCommentabilityIndex;
}): Promise<ReviewCandidatePublicationPreparationResult> {
  const extractionOctokit = await params.getOctokit();
  const reviewCandidateFindingContext = await resolveReviewCandidateFindingContext({
    candidateFinding: params.candidateFinding,
    executionSucceeded: params.reviewOutputSucceeded,
    octokit: extractionOctokit,
    logger: params.logger,
    baseLog: params.baseLog,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.pr.number,
    deliveryId: params.deliveryId,
    reviewOutputKey: params.reviewOutputKey,
  });
  const reviewCandidateFindingResult = reviewCandidateFindingContext.result;
  const extractedFindings = reviewCandidateFindingContext.extractedFindings;

  const feedbackSuppression = await resolveReviewFeedbackSuppression({
    knowledgeStore: params.knowledgeStore,
    repo: `${params.owner}/${params.repo}`,
    config: params.config.feedback.autoSuppress,
    logger: params.logger,
  });

  const graphValidationLLM = resolveReviewGraphValidationLLM({
    enabled: params.config.review.graphValidation.enabled,
    hasGraphBlastRadius: Boolean(params.graphBlastRadius),
    repo: `${params.owner}/${params.repo}`,
    deliveryId: params.deliveryId,
    logger: params.logger,
  });

  const reviewReducerInput = buildReviewReducerInput({
    extractedFindings,
    reviewCandidateFindingResult,
    workspaceDir: params.workspaceDir,
    filesByCategory: params.diffAnalysis.filesByCategory,
    filesByLanguage: params.diffAnalysis.filesByLanguage,
    languageRules: params.config.languageRules,
    reviewSuppressions: params.config.review.suppressions,
    minConfidence: params.config.review.minConfidence,
    prioritizationWeights: params.config.review.prioritization,
    feedbackSuppression,
    priorFindingContext: params.priorFindingContext,
    diffContent: params.diffContent,
    prBody: params.pr.body ?? null,
    commitMessages: params.commitMessages,
    tieredFiles: params.tieredFiles,
    graphBlastRadius: params.graphBlastRadius,
    graphValidationEnabled: params.config.review.graphValidation.enabled,
    riskScores: params.riskScores,
    resolvedMaxComments: params.resolvedMaxComments,
    logger: params.logger,
    baseLog: params.baseLog,
    repo: `${params.owner}/${params.repo}`,
    clusterModelStore: params.clusterModelStore,
    embeddingProvider: params.embeddingProvider,
    guardrailAuditStore: params.guardrailAuditStore,
    guardrailStrictness: params.config.guardrails?.strictness ?? "standard",
    graphValidationLLM,
    repoDoctrine: params.repoDoctrineReviewSurface,
  });

  const reducerResult = await runReviewReducerFailOpen({
    reducer: params.reviewReducer,
    input: reviewReducerInput,
    graphValidationEnabled: params.config.review.graphValidation.enabled,
    logger: params.logger,
    baseLog: params.baseLog,
  });

  const reviewCandidateApprovalContext = resolveReviewCandidateApprovalContext({
    candidates: reviewCandidateFindingResult,
    reducer: reducerResult,
    resultPublished: params.resultPublished,
    extractedFindingCount: extractedFindings.length,
    minConfidence: params.config.review.minConfidence,
    prDiffText: params.diffContent,
    maxFixSuggestions: params.resolvedMaxComments,
    logger: params.logger,
  });
  const reviewCandidatePublicationAdapter = reviewCandidateApprovalContext.publicationAdapter;

  const candidateInlinePublication = await publishReviewCandidateInlineComments({
    payloads: reviewCandidatePublicationAdapter.payloads,
    canPublishVisibleOutput: params.canPublishVisibleOutput,
    getOctokit: async () => extractionOctokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.pr.number,
    botHandles: [params.appSlug, "claude"],
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    logger: params.logger,
    candidateVerificationContext: params.candidateVerificationContext,
    prDiffCommentabilityIndex: params.prDiffCommentabilityIndex,
  });

  return {
    extractionOctokit,
    reviewCandidateFindingResult,
    reviewCandidateFindingDetailsSummary: reviewCandidateFindingContext.detailsSummary,
    reviewCandidateFindingConfigSnapshot: reviewCandidateFindingContext.configSnapshot,
    extractedFindings,
    feedbackSuppression,
    reducerResult,
    directFallbackAllowed: reviewCandidateApprovalContext.directFallbackAllowed,
    directPublicationAttempted: reviewCandidateApprovalContext.directPublicationAttempted,
    reviewCandidateApprovalResult: reviewCandidateApprovalContext.approval,
    reviewCandidatePublicationAdapter,
    candidatePublisherResults: candidateInlinePublication.results,
    reviewCandidateVerificationPublicationEvidence:
      candidateInlinePublication.candidateVerificationPublicationEvidence
      ?? params.initialCandidateVerificationPublicationEvidence,
  };
}
