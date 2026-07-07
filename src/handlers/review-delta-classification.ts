import type { Logger } from "pino";
import {
  classifyFindingDeltas,
  type DeltaClassification,
  type FindingForDelta,
} from "../lib/delta-classifier.ts";
import { fingerprintFindingTitle } from "../lib/review-finding-metadata.ts";
import type { KnowledgeStore, PriorFinding } from "../knowledge/types.ts";

export function buildReviewDeltaPriorFindingLookup(params: {
  knowledgeStore: Pick<KnowledgeStore, "getPriorReviewFindings"> | undefined;
  repo: string;
  prNumber: number;
}): (() => Promise<PriorFinding[]>) | undefined {
  const { knowledgeStore } = params;
  if (!knowledgeStore) {
    return undefined;
  }

  return () =>
    knowledgeStore.getPriorReviewFindings({
      repo: params.repo,
      prNumber: params.prNumber,
    });
}

export async function resolveReviewDeltaClassification(params: {
  enabled: boolean;
  currentFindings: FindingForDelta[];
  getPriorReviewFindings?: () => Promise<PriorFinding[]>;
  logger: Pick<Logger, "warn">;
  baseLog: Record<string, unknown>;
}): Promise<DeltaClassification | null> {
  if (!params.enabled || !params.getPriorReviewFindings) {
    return null;
  }

  try {
    const priorFindings = await params.getPriorReviewFindings();
    if (priorFindings.length === 0) {
      return null;
    }

    return classifyFindingDeltas({
      currentFindings: params.currentFindings,
      priorFindings,
      fingerprintFn: fingerprintFindingTitle,
    });
  } catch (err) {
    params.logger.warn(
      { ...params.baseLog, err },
      "Delta classification failed (fail-open, publishing without delta labels)",
    );
    return null;
  }
}
