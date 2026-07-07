import type { CheckpointRecord } from "../knowledge/types.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import {
  normalizeReviewFirstPass,
  type ReviewFirstPassOutcome,
  type ReviewFirstPassPayload,
} from "../lib/review-first-pass.ts";
import type { ExtractedFinding } from "../review-orchestration/review-comment-finding-extraction.ts";

type ReviewTimeoutProgressKnowledgeStore = {
  getCheckpoint?: (reviewOutputKey: string) => Promise<CheckpointRecord | null>;
};

type ReviewTimeoutProgressExtractionParams = {
  octokit: unknown;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  logger: unknown;
  baseLog: Record<string, unknown>;
};

export type ReviewTimeoutProgressContext = {
  checkpoint: CheckpointRecord | null;
  hasPublishedInlines: boolean;
  timeoutInlineFindings: ExtractedFinding[];
  timeoutReviewedFiles: string[];
  timeoutInspectedFiles: string[];
  timeoutFindingCount: number;
  timeoutTotalFiles: number;
  timeoutFirstPass: ReviewFirstPassPayload | null;
  hasPartialResults: boolean;
};

export function buildReviewTimeoutProgressAdapters<TExtraction extends ReviewTimeoutProgressExtractionParams>(params: {
  knowledgeStore: ReviewTimeoutProgressKnowledgeStore | undefined;
  extractFindingsFromReviewComments: (params: TExtraction) => Promise<ExtractedFinding[]>;
  extraction: TExtraction;
}): {
  getCheckpoint: (reviewOutputKey: string) => Promise<CheckpointRecord | null>;
  extractInlineFindings: () => Promise<ExtractedFinding[]>;
} {
  return {
    getCheckpoint: async (reviewOutputKey) =>
      (await params.knowledgeStore?.getCheckpoint?.(reviewOutputKey)) ?? null,
    extractInlineFindings: async () =>
      await params.extractFindingsFromReviewComments(params.extraction),
  };
}

export async function resolveReviewTimeoutProgressContext(params: {
  reviewOutputKey: string;
  changedFileCount: number;
  reviewBoundedness: ReviewBoundednessContract | null | undefined;
  outcome: ReviewFirstPassOutcome;
  getCheckpoint: (reviewOutputKey: string) => Promise<CheckpointRecord | null>;
  extractInlineFindings: () => Promise<ExtractedFinding[]>;
}): Promise<ReviewTimeoutProgressContext> {
  const checkpoint = await params.getCheckpoint(params.reviewOutputKey);
  const hasPublishedInlines = params.outcome.published ?? false;
  const timeoutInlineFindings = hasPublishedInlines
    ? await params.extractInlineFindings()
    : [];
  const timeoutReviewedFiles = Array.from(new Set([
    ...(checkpoint?.filesReviewed ?? []),
    ...timeoutInlineFindings.map((finding) => finding.filePath),
  ]));
  const timeoutInspectedFiles = Array.from(new Set([
    ...timeoutReviewedFiles,
    ...(checkpoint?.filesInspected ?? []),
  ]));
  const timeoutFindingCount = Math.max(
    checkpoint?.findingCount ?? 0,
    timeoutInlineFindings.length,
  );
  const timeoutTotalFiles = checkpoint?.totalFiles ?? params.changedFileCount;
  const timeoutFirstPass = normalizeReviewFirstPass({
    boundedness: params.reviewBoundedness,
    checkpoint,
    outcome: params.outcome,
  });

  return {
    checkpoint,
    hasPublishedInlines,
    timeoutInlineFindings,
    timeoutReviewedFiles,
    timeoutInspectedFiles,
    timeoutFindingCount,
    timeoutTotalFiles,
    timeoutFirstPass,
    hasPartialResults: timeoutFirstPass?.state === "bounded-first-pass",
  };
}
