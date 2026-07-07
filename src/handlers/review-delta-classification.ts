import type { Logger } from "pino";
import {
  classifyFindingDeltas,
  type DeltaClassification,
  type FindingForDelta,
} from "../lib/delta-classifier.ts";
import { fingerprintFindingTitle } from "../lib/review-finding-metadata.ts";
import type { PriorFinding } from "../knowledge/types.ts";

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
