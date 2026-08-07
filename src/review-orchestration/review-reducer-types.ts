import type { FeedbackSuppressionResult } from "../feedback/index.ts";
import type { FilteredFindingRecord } from "../lib/output-filter.ts";
import type { GuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import type { FindingClaimClassification } from "../lib/claim-classifier.ts";
import type { FindingPriorityWeights } from "../lib/finding-prioritizer.ts";
import type { SuppressionPattern } from "../knowledge/confidence.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import type { SuggestionClusterStore } from "../knowledge/suggestion-cluster-store.ts";
import type { PriorFindingContext } from "../lib/finding-dedup.ts";
import type { FindingCategory, FindingSeverity } from "../lib/review-finding-metadata.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import type { GraphValidationFinding, GraphValidationResult, GraphValidationVerdict, ValidationLLM } from "../review-graph/validation.ts";
import type { LanguageRulesConfig } from "../enforcement/types.ts";
import type { SemanticGroundingLLM, SemanticGroundingOptions } from "../enforcement/index.ts";
import type { GateAdjustedFinding, GateOutcome } from "../enforcement/gate-outcome.ts";

/**
 * Shared shapes for the review reducer pipeline.
 *
 * Split out so the reducer, its summary projection, and its callers can agree
 * on one contract without importing the whole 900-line implementation module.
 */

export type ReviewReducerStatus = "ready" | "degraded";
export type RepoDoctrineReducerStatus = "disabled" | "skipped" | "degraded" | "applied";
export type RepoDoctrineReducerProjection = {
  status: RepoDoctrineReducerStatus;
  contractCount: number;
  matchedCount: number;
  omittedCount: number;
  reasonCodes: string[];
};

export type ReviewReducerFindingAction =
  | "kept"
  | "suppressed"
  | "rewritten"
  | "guardrail-suppressed"
  | "guardrail-rewritten"
  | "deprioritized"
  | "low-confidence"
  | "severity-demoted"
  | "graph-validated"
  | "degraded-fail-open";

export type ProcessedReviewFinding = {
  commentId: number;
  filePath: string;
  title: string;
  severity: FindingSeverity | string;
  category: FindingCategory | string;
  startLine?: number;
  endLine?: number;
  suppressed?: boolean;
  confidence?: number;
  suppressionPattern?: string;
  deprioritized?: boolean;
  claimClassification?: FindingClaimClassification;
  preDemotionSeverity?: FindingSeverity | string;
  severityDemoted?: boolean;
  demotionReason?: string;
  filterAction?: "rewritten" | "suppressed" | "guardrail-suppressed" | "guardrail-rewritten";
  originalTitle?: string;
  graphValidated?: boolean;
  graphValidationVerdict?: GraphValidationVerdict | "confirmed" | "uncertain" | "skipped" | string;
  toolingSuppressed?: boolean;
  enforcementPatternId?: string;
  originalSeverity?: FindingSeverity | string;
  severityElevated?: boolean;
  /** Per-gate fact-check outcomes recorded by the enforcement pipeline. */
  gateOutcomes?: GateOutcome[];
  [key: string]: unknown;
};

export type ReviewReducerCounts = {
  input: number;
  kept: number;
  suppressed: number;
  rewritten: number;
  deprioritized: number;
  lowConfidence: number;
  auditEvents: number;
  severityDemoted: number;
  graphValidated: number;
  graphUncertain: number;
};

export type ReviewReducerAuditEvent = {
  action: ReviewReducerFindingAction;
  source: string;
  count?: number;
  reason?: string;
};

export type ReviewReducerDetailsSummary = {
  label: "Review reducer";
  text: string;
  status: ReviewReducerStatus;
};

export type ReviewReducerResult = {
  status: ReviewReducerStatus;
  findings: ProcessedReviewFinding[];
  visibleFindings: ProcessedReviewFinding[];
  filteredInlineFindings: ProcessedReviewFinding[];
  lowConfidenceFindings: ProcessedReviewFinding[];
  suppressionMatchCounts: Map<string, number>;
  filterRecords: FilteredFindingRecord[];
  prioritizationStats?: ReviewReducerPrioritizationStats;
  counts: ReviewReducerCounts;
  audit: ReviewReducerAuditEvent[];
  reason?: string;
  detailsSummary: ReviewReducerDetailsSummary;
};

export type ReviewReducerPrioritizationStats = {
  findingsScored: number;
  topScore: number | null;
  thresholdScore: number | null;
  maxComments?: number;
  selectedFindings?: number;
  omittedFindings?: number;
};

export type ReducerLogger = {
  info: (obj: unknown, msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
  error?: (obj: unknown, msg: string) => void;
  debug?: (obj: unknown, msg: string) => void;
};

export type TieredReducerFiles = {
  isLargePR: boolean;
  abbreviated: Array<{ filePath: string }>;
};

export type FileRiskInput = {
  filePath: string;
  score: number;
};

export type EnforcedExtractedFinding = ProcessedReviewFinding & {
  originalSeverity: FindingSeverity;
  severityElevated: boolean;
  toolingSuppressed: boolean;
  enforcementPatternId?: string;
} & GateAdjustedFinding;

export type ReviewGuardrailRunner = (opts: unknown) => Promise<unknown>;

export type GraphValidationRunner = <T extends GraphValidationFinding>(
  findings: T[],
  blastRadius: ReviewGraphBlastRadiusResult | null | undefined,
  llm: ValidationLLM | null | undefined,
  options: { enabled?: boolean },
  logger: ReducerLogger,
) => Promise<GraphValidationResult<T>>;

export type ReviewReducerInput = {
  findings: ProcessedReviewFinding[];
  workspaceDir: string;
  filesByCategory: Record<string, string[]>;
  filesByLanguage: Record<string, string[]>;
  languageRules?: LanguageRulesConfig;
  /**
   * Optional LLM + options for the semantic grounding re-verification pass
   * (enforcement/semantic-grounding.ts). When omitted, or when
   * `semanticGroundingOptions.enabled` is not true, the pass is a no-op --
   * semantic grounding is opt-in, same as graph validation below.
   */
  semanticGroundingLLM?: SemanticGroundingLLM | null;
  semanticGroundingOptions?: SemanticGroundingOptions;
  reviewSuppressions: Array<string | SuppressionPattern>;
  minConfidence: number;
  prioritizationWeights?: FindingPriorityWeights;
  feedbackSuppression: FeedbackSuppressionResult;
  priorFindingContext?: PriorFindingContext | null;
  diffContent?: string | null;
  prBody?: string | null;
  commitMessages: string[];
  tieredFiles: TieredReducerFiles;
  graphBlastRadius?: ReviewGraphBlastRadiusResult | null;
  graphValidationEnabled: boolean;
  riskScores: FileRiskInput[];
  resolvedMaxComments?: number;
  logger: ReducerLogger;
  baseLog: Record<string, unknown>;
  repo: string;
  clusterModelStore?: SuggestionClusterStore | null;
  embeddingProvider?: EmbeddingProvider | null;
  guardrailAuditStore?: GuardrailAuditStore;
  guardrailStrictness?: "standard" | "strict" | "lenient";
  graphValidationLLM?: ValidationLLM | null;
  repoDoctrine?: Partial<RepoDoctrineReducerProjection> | null;
  runGuardrailPipeline?: ReviewGuardrailRunner;
  validateGraphAmplifiedFindings?: GraphValidationRunner;
};

export type CountOptions = {
  minConfidence?: number;
};

export type DegradedReviewReducerInput = {
  findings: ProcessedReviewFinding[];
  reason: string;
};
