import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { PrDiffCommentabilityIndex } from "../execution/formatter-suggestions.ts";
import {
  createInlineReviewPublisher,
  type InlineReviewPublicationResult,
  type InlineReviewPublisherOptions,
  type PublishInlineReviewCommentInput,
} from "../execution/mcp/inline-review-publisher.ts";
import {
  createReviewOutputPublicationGate,
  type CandidateVerificationContext,
} from "../execution/mcp/review-output-publication-gate.ts";
import {
  createCandidateVerificationPublicationEvidenceCollector,
  type CandidateVerificationPublicationEvidenceSummary,
} from "../specialists/candidate-verification-publication-evidence.ts";
import {
  buildCandidateReviewOutputKey,
  type PublishableReviewCandidateInlinePayload,
} from "../review-orchestration/review-candidate-publication-adapter.ts";
import { err, ok, type Result } from "../lib/result.ts";

type CandidateInlinePublisher = {
  publish(input: PublishInlineReviewCommentInput): Promise<InlineReviewPublicationResult>;
};

type CreateInlineReviewPublisher = (options: InlineReviewPublisherOptions) => CandidateInlinePublisher;
type CreateReviewOutputPublicationGate = typeof createReviewOutputPublicationGate;

export type ReviewCandidateInlinePublicationValue = {
  results: Map<string, InlineReviewPublicationResult>;
  candidateVerificationPublicationEvidence?: CandidateVerificationPublicationEvidenceSummary;
};

export type ReviewCandidateInlinePublicationError = ReviewCandidateInlinePublicationValue & {
  error: unknown;
};

export type ReviewCandidateInlinePublicationResult = Result<
  ReviewCandidateInlinePublicationValue,
  ReviewCandidateInlinePublicationError
>;

export async function publishReviewCandidateInlineComments(params: {
  payloads: PublishableReviewCandidateInlinePayload[];
  canPublishVisibleOutput: (label: string) => boolean;
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  prNumber: number;
  botHandles: string[];
  reviewOutputKey: string;
  deliveryId: string;
  logger?: Logger;
  candidateVerificationContext?: CandidateVerificationContext;
  prDiffCommentabilityIndex?: PrDiffCommentabilityIndex;
  createPublisher?: CreateInlineReviewPublisher;
  createPublicationGate?: CreateReviewOutputPublicationGate;
}): Promise<ReviewCandidateInlinePublicationResult> {
  const results = new Map<string, InlineReviewPublicationResult>();
  let candidateVerificationPublicationEvidence: CandidateVerificationPublicationEvidenceSummary | undefined;
  const createPublisher = params.createPublisher ?? createInlineReviewPublisher;
  const createPublicationGate = params.createPublicationGate ?? createReviewOutputPublicationGate;
  const evidenceCollector = createCandidateVerificationPublicationEvidenceCollector((summary) => {
    candidateVerificationPublicationEvidence = summary;
  });

  const publicationValue = (): ReviewCandidateInlinePublicationValue => ({
    results,
    ...(candidateVerificationPublicationEvidence ? { candidateVerificationPublicationEvidence } : {}),
  });

  if (params.payloads.length === 0) {
    return ok(publicationValue());
  }

  if (!params.canPublishVisibleOutput("candidate-approved inline review comments")) {
    for (const payload of params.payloads) {
      results.set(payload.candidateFingerprint, {
        status: "blocked",
        reason: "publication-failed",
        content: [{ type: "text", text: "Candidate publication skipped because review publish rights were superseded." }],
        isError: true,
      });
    }
    return ok(publicationValue());
  }

  for (const payload of params.payloads) {
    if (!params.canPublishVisibleOutput("candidate-approved inline review comments")) {
      results.set(payload.candidateFingerprint, {
        status: "blocked",
        reason: "publication-failed",
        content: [{ type: "text", text: "Candidate publication skipped because review publish rights were superseded." }],
        isError: true,
      });
      continue;
    }

    const candidateReviewOutputKey = buildCandidateReviewOutputKey(params.reviewOutputKey, payload.candidateFingerprint);
    const candidatePublisher = createPublisher({
      getOctokit: params.getOctokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      botHandles: params.botHandles,
      reviewOutputKey: candidateReviewOutputKey,
      deliveryId: params.deliveryId,
      logger: params.logger,
      publicationGate: createPublicationGate({
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: candidateReviewOutputKey,
        candidateVerificationContext: params.candidateVerificationContext,
        candidateVerificationPublicationEvidenceSink: (_summary, event) => {
          evidenceCollector.record(event);
        },
      }),
      prDiffCommentabilityIndex: params.prDiffCommentabilityIndex,
    });
    try {
      const publishResult = await candidatePublisher.publish(payload.publication);
      results.set(payload.candidateFingerprint, publishResult);
    } catch (error) {
      return err({
        ...publicationValue(),
        error,
      });
    }
  }

  return ok(publicationValue());
}
