import type { FindingClaimClassification } from "../lib/claim-classifier.ts";
import type { FindingSeverity } from "../lib/review-finding-metadata.ts";
import type { ExtractedFinding } from "../review-orchestration/review-comment-finding-extraction.ts";

export type ProcessedFinding = ExtractedFinding & {
  suppressed: boolean;
  confidence: number;
  suppressionPattern?: string;
  deprioritized?: boolean;
  claimClassification?: FindingClaimClassification;
  preDemotionSeverity?: FindingSeverity;
  severityDemoted?: boolean;
  demotionReason?: string;
  filterAction?: "rewritten" | "suppressed" | "guardrail-suppressed" | "guardrail-rewritten";
  originalTitle?: string;
};
