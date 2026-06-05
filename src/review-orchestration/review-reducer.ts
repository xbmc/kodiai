import { applyEnforcement } from "../enforcement/index.ts";
import type { FeedbackSuppressionResult } from "../feedback/index.ts";
import { adjustConfidenceForFeedback } from "../feedback/index.ts";
import { reviewAdapter, type ReviewInput } from "../lib/guardrail/adapters/review-adapter.ts";
import { runGuardrailPipeline as defaultRunGuardrailPipeline } from "../lib/guardrail/pipeline.ts";
import type { GuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import { buildFileDiffsMap, classifyClaims, type FindingClaimClassification, type FindingForClassification } from "../lib/claim-classifier.ts";
import { demoteExternalClaimSeverities, type DemotableFinding } from "../lib/severity-demoter.ts";
import { filterExternalClaims, type FilterableFinding, type FilteredFindingRecord } from "../lib/output-filter.ts";
import { prioritizeFindings, type FindingPriorityWeights } from "../lib/finding-prioritizer.ts";
import { computeConfidence, matchesSuppression, type SuppressionPattern } from "../knowledge/confidence.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import type { SuggestionClusterStore } from "../knowledge/suggestion-cluster-store.ts";
import { applyClusterScoringWithDegradation } from "../knowledge/suggestion-cluster-degradation.ts";
import type { PriorFindingContext } from "../lib/finding-dedup.ts";
import { shouldSuppressFinding } from "../lib/finding-dedup.ts";
import { fingerprintFindingTitle, type FindingCategory, type FindingSeverity } from "../lib/review-finding-metadata.ts";
import { splitDiffByFile } from "../lib/review-git-utils.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import { validateGraphAmplifiedFindings as defaultValidateGraphAmplifiedFindings, type GraphValidationFinding, type GraphValidationResult, type GraphValidationVerdict, type ValidationLLM } from "../review-graph/validation.ts";
import type { LanguageRulesConfig } from "../enforcement/types.ts";

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

type ReducerLogger = {
  info: (obj: unknown, msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
  error?: (obj: unknown, msg: string) => void;
  debug?: (obj: unknown, msg: string) => void;
};

type TieredReducerFiles = {
  isLargePR: boolean;
  abbreviated: Array<{ filePath: string }>;
};

type FileRiskInput = {
  filePath: string;
  score: number;
};

type EnforcedExtractedFinding = ProcessedReviewFinding & {
  originalSeverity: FindingSeverity;
  severityElevated: boolean;
  toolingSuppressed: boolean;
  enforcementPatternId?: string;
};

type ReviewGuardrailRunner = (opts: unknown) => Promise<unknown>;

type GraphValidationRunner = <T extends GraphValidationFinding>(
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

type CountOptions = {
  minConfidence?: number;
};

type DegradedReviewReducerInput = {
  findings: ProcessedReviewFinding[];
  reason: string;
};

const DEFAULT_MIN_CONFIDENCE = 50;
const DEFAULT_FAIL_OPEN_CONFIDENCE = 100;
const MAX_SUMMARY_LENGTH = 240;
const MAX_REASON_LENGTH = 64;

export function buildReviewReducerCounts(
  findings: ReadonlyArray<ProcessedReviewFinding>,
  audit: ReadonlyArray<ReviewReducerAuditEvent> = [],
  options: CountOptions = {},
): ReviewReducerCounts {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  let suppressed = 0;
  let rewritten = 0;
  let deprioritized = 0;
  let lowConfidence = 0;
  let severityDemoted = 0;
  let graphValidated = 0;
  let graphUncertain = 0;

  for (const finding of findings) {
    if (finding.suppressed === true) {
      suppressed += 1;
    }

    if (finding.filterAction === "rewritten" || finding.filterAction === "guardrail-rewritten") {
      rewritten += 1;
    }

    if (finding.deprioritized === true) {
      deprioritized += 1;
    }

    if (
      finding.suppressed !== true
      && finding.deprioritized !== true
      && typeof finding.confidence === "number"
      && Number.isFinite(finding.confidence)
      && finding.confidence < minConfidence
    ) {
      lowConfidence += 1;
    }

    if (finding.severityDemoted === true) {
      severityDemoted += 1;
    }

    if (finding.graphValidated === true) {
      graphValidated += 1;
    }

    if (finding.graphValidationVerdict === "uncertain") {
      graphUncertain += 1;
    }
  }

  const kept = findings.filter((finding) => {
    const isLowConfidence = typeof finding.confidence === "number" && Number.isFinite(finding.confidence) && finding.confidence < minConfidence;
    return finding.suppressed !== true && finding.deprioritized !== true && !isLowConfidence;
  }).length;

  return {
    input: findings.length,
    kept,
    suppressed,
    rewritten,
    deprioritized,
    lowConfidence,
    auditEvents: audit.length,
    severityDemoted,
    graphValidated,
    graphUncertain,
  };
}

export function createDegradedReviewReducerResult(input: DegradedReviewReducerInput): ReviewReducerResult {
  const visibleFindings = input.findings.map((finding) => ({
    ...finding,
    confidence: typeof finding.confidence === "number" && Number.isFinite(finding.confidence)
      ? finding.confidence
      : DEFAULT_FAIL_OPEN_CONFIDENCE,
  }));
  const safeReason = sanitizeSummaryToken(input.reason);
  const counts: ReviewReducerCounts = {
    input: visibleFindings.length,
    kept: visibleFindings.length,
    suppressed: 0,
    rewritten: 0,
    deprioritized: 0,
    lowConfidence: 0,
    auditEvents: 1,
    severityDemoted: 0,
    graphValidated: 0,
    graphUncertain: 0,
  };
  const resultLike = {
    status: "degraded" as const,
    counts,
    reason: safeReason,
  };

  return {
    status: "degraded",
    findings: visibleFindings,
    visibleFindings,
    filteredInlineFindings: [],
    lowConfidenceFindings: [],
    suppressionMatchCounts: new Map(),
    filterRecords: [],
    counts,
    audit: [{ action: "degraded-fail-open", source: "review-reducer", reason: safeReason }],
    reason: safeReason,
    detailsSummary: toReviewReducerDetailsSummary(resultLike),
  };
}

export async function reduceReviewFindings(input: ReviewReducerInput): Promise<ReviewReducerResult> {
  const audit: ReviewReducerAuditEvent[] = [];
  const repoDoctrine = normalizeRepoDoctrineReducerProjection(input.repoDoctrine);

  try {
    const enforcedFindings = input.findings.length > 0
      ? await applyEnforcement({
          findings: input.findings as Array<ProcessedReviewFinding & { severity: FindingSeverity; category: FindingCategory }>,
          workspaceDir: input.workspaceDir,
          filesByCategory: input.filesByCategory,
          filesByLanguage: input.filesByLanguage,
          languageRules: input.languageRules,
          logger: input.logger,
        }) as EnforcedExtractedFinding[]
      : [];

    const toolingSuppressedCount = enforcedFindings.filter((finding) => finding.toolingSuppressed).length;
    const severityElevatedCount = enforcedFindings.filter((finding) => finding.severityElevated).length;
    if (toolingSuppressedCount > 0 || severityElevatedCount > 0) {
      audit.push({ action: "suppressed", source: "enforcement", count: toolingSuppressedCount });
      input.logger.info(
        { ...input.baseLog, toolingSuppressedCount, severityElevatedCount },
        "Language enforcement applied",
      );
    }

    if (input.feedbackSuppression.suppressedPatternCount > 0) {
      audit.push({ action: "suppressed", source: "feedback", count: input.feedbackSuppression.suppressedPatternCount });
      input.logger.info(
        { ...input.baseLog, feedbackSuppressedPatterns: input.feedbackSuppression.suppressedPatternCount },
        "Feedback-driven suppression applied",
      );
    }

    const abbreviatedFileSet = input.tieredFiles.isLargePR
      ? new Set(input.tieredFiles.abbreviated.map((file) => file.filePath))
      : new Set<string>();

    const fileDiffs = input.diffContent
      ? buildFileDiffsMap(splitDiffByFile(input.diffContent))
      : new Map();

    const classifiedFindings = classifyClaims({
      findings: enforcedFindings as unknown as FindingForClassification[],
      fileDiffs,
      prDescription: input.prBody ?? null,
      commitMessages: input.commitMessages,
    });
    const claimClassificationMap = new Map(
      classifiedFindings.map((finding) => [finding.commentId, finding.claimClassification]),
    );
    for (const finding of enforcedFindings) {
      if (finding.claimClassification && !claimClassificationMap.has(finding.commentId)) {
        claimClassificationMap.set(finding.commentId, finding.claimClassification);
      }
      if (finding.claimClassification && !input.diffContent) {
        claimClassificationMap.set(finding.commentId, finding.claimClassification);
      }
    }

    const externalClaimCount = [...claimClassificationMap.values()].filter(
      (classification) => classification?.summaryLabel === "primarily-external",
    ).length;
    const mixedClaimCount = [...claimClassificationMap.values()].filter(
      (classification) => classification?.summaryLabel === "mixed",
    ).length;
    if (externalClaimCount > 0 || mixedClaimCount > 0) {
      audit.push({ action: "kept", source: "claim-classifier", count: externalClaimCount + mixedClaimCount });
      input.logger.info(
        { ...input.baseLog, externalClaimFindings: externalClaimCount, mixedClaimFindings: mixedClaimCount },
        "Claim classification applied",
      );
    }

    const demotedFindings = demoteExternalClaimSeverities(
      (enforcedFindings as unknown as DemotableFinding[]).map((finding) => ({
        ...finding,
        claimClassification: claimClassificationMap.get((finding as unknown as { commentId: number }).commentId),
      })),
      input.logger,
    );
    const demotionMap = new Map(
      demotedFindings
        .filter((finding) => finding.severityDemoted)
        .map((finding) => [finding.commentId, {
          severity: finding.severity as FindingSeverity,
          preDemotionSeverity: finding.preDemotionSeverity!,
          demotionReason: finding.demotionReason!,
        }]),
    );
    if (demotionMap.size > 0) {
      audit.push({ action: "severity-demoted", source: "severity-demoter", count: demotionMap.size });
      input.logger.info(
        { ...input.baseLog, demotedFindings: demotionMap.size },
        "Severity demotion applied to external-claim findings",
      );
    }

    const suppressionMatchCounts = new Map<string, number>();
    let processedFindings: ProcessedReviewFinding[] = enforcedFindings.map((finding) => {
      const category = finding.category as FindingCategory;
      const matchedSuppression = input.reviewSuppressions.find((suppression) =>
        matchesSuppression(
          {
            filePath: finding.filePath,
            title: finding.title,
            severity: finding.severity as FindingSeverity,
            category,
          },
          suppression,
        )
      );
      const dedupSuppressed = input.priorFindingContext
        ? shouldSuppressFinding({
            filePath: finding.filePath,
            titleFingerprint: fingerprintFindingTitle(finding.title),
            suppressionFingerprints: input.priorFindingContext.suppressionFingerprints,
          })
        : false;
      const abbreviatedSuppressed = abbreviatedFileSet.has(finding.filePath)
        && (finding.severity === "medium" || finding.severity === "minor");
      const titleFp = fingerprintFindingTitle(finding.title);
      const feedbackSuppressed = input.feedbackSuppression.suppressedFingerprints.has(titleFp);
      const suppressed = finding.toolingSuppressed || Boolean(matchedSuppression) || dedupSuppressed || abbreviatedSuppressed || feedbackSuppressed;
      const suppressionPattern = typeof matchedSuppression === "string"
        ? matchedSuppression
        : matchedSuppression?.pattern;
      if (suppressionPattern) {
        suppressionMatchCounts.set(suppressionPattern, (suppressionMatchCounts.get(suppressionPattern) ?? 0) + 1);
      }

      const feedbackPattern = input.feedbackSuppression.patterns.find((pattern) => pattern.fingerprint === titleFp);
      const baseConfidence = computeConfidence({
        severity: finding.severity as FindingSeverity,
        category,
        matchesKnownPattern: Boolean(matchedSuppression),
      });
      const confidence = feedbackPattern
        ? adjustConfidenceForFeedback(baseConfidence, {
            thumbsUp: feedbackPattern.thumbsUpCount,
            thumbsDown: feedbackPattern.thumbsDownCount,
          })
        : baseConfidence;

      const demotion = demotionMap.get(finding.commentId);
      const effectiveSeverity = demotion ? demotion.severity : finding.severity;

      return {
        ...finding,
        severity: effectiveSeverity,
        category,
        suppressed,
        confidence,
        suppressionPattern,
        claimClassification: claimClassificationMap.get(finding.commentId),
        preDemotionSeverity: demotion?.preDemotionSeverity,
        severityDemoted: demotion ? true : undefined,
        demotionReason: demotion?.demotionReason,
      };
    });

    const clusterResult = await applyClusterScoringWithDegradation(
      processedFindings.map((finding) => ({
        ...finding,
        severity: finding.severity as FindingSeverity,
        category: finding.category as FindingCategory,
        confidence: typeof finding.confidence === "number" ? finding.confidence : DEFAULT_FAIL_OPEN_CONFIDENCE,
      })),
      input.clusterModelStore ?? null,
      input.embeddingProvider ?? null,
      input.repo,
      input.logger as never,
    );
    if (clusterResult.modelUsed) {
      audit.push({ action: "kept", source: "cluster-scoring", count: processedFindings.length });
      processedFindings = processedFindings.map((finding, index) => {
        const adjusted = clusterResult.findings[index];
        if (!adjusted) return finding;
        return { ...finding, confidence: adjusted.confidence, suppressed: adjusted.suppressed };
      });
    }

    const filterResult = filterExternalClaims(processedFindings as FilterableFinding[], input.logger);
    if (filterResult.suppressionCount > 0 || filterResult.rewriteCount > 0) {
      const suppressedIds = new Set(
        filterResult.filtered
          .filter((record) => record.action === "suppressed")
          .map((record) => record.commentId),
      );
      const rewriteMap = new Map(
        filterResult.filtered
          .filter((record) => record.action === "rewritten")
          .map((record) => [record.commentId, record.rewrittenTitle!]),
      );

      processedFindings = processedFindings.map((finding) => {
        if (suppressedIds.has(finding.commentId)) {
          return { ...finding, suppressed: true, filterAction: "suppressed" as const, originalTitle: finding.title };
        }
        const rewrittenTitle = rewriteMap.get(finding.commentId);
        if (rewrittenTitle) {
          return { ...finding, title: rewrittenTitle, filterAction: "rewritten" as const, originalTitle: finding.title };
        }
        return finding;
      });
      if (filterResult.suppressionCount > 0) {
        audit.push({ action: "suppressed", source: "output-filter", count: filterResult.suppressionCount });
      }
      if (filterResult.rewriteCount > 0) {
        audit.push({ action: "rewritten", source: "output-filter", count: filterResult.rewriteCount });
      }
      input.logger.info(
        {
          ...input.baseLog,
          rewriteCount: filterResult.rewriteCount,
          suppressionCount: filterResult.suppressionCount,
          filteredFindings: filterResult.filtered.map((record) => ({
            commentId: record.commentId,
            action: record.action,
            originalTitle: record.originalTitle.slice(0, 100),
            reason: record.reason,
          })),
        },
        "Output filter applied: external knowledge claims filtered",
      );
    }

    try {
      const guardrailRunner = input.runGuardrailPipeline ?? defaultRunGuardrailPipeline;
      const guardResult = await guardrailRunner({
        adapter: reviewAdapter,
        input: {
          findings: enforcedFindings as unknown as Array<FindingForClassification>,
          fileDiffs,
          prDescription: input.prBody ?? null,
          commitMessages: input.commitMessages,
        } satisfies ReviewInput,
        output: {
          findings: processedFindings as unknown as import("../lib/guardrail/adapters/review-adapter.ts").ReviewFinding[],
        },
        config: { strictness: input.guardrailStrictness ?? "standard" },
        repo: input.repo,
        auditStore: input.guardrailAuditStore,
      }) as {
        output: { findings: Array<{ commentId: number; title: string }> } | null;
        claimsTotal: number;
        claimsRemoved: number;
        suppressed: boolean;
      };
      if (guardResult.claimsRemoved > 0) {
        input.logger.info(
          {
            ...input.baseLog,
            guardrailClaimsTotal: guardResult.claimsTotal,
            guardrailClaimsRemoved: guardResult.claimsRemoved,
            guardrailSuppressed: guardResult.suppressed,
          },
          "Guardrail pipeline applied to review findings",
        );
      }
      if (guardResult.output !== null && !guardResult.suppressed) {
        let guardrailSuppressed = 0;
        let guardrailRewritten = 0;
        const guardFindingByCommentId = new Map(
          guardResult.output.findings.map((guardFinding: { commentId: number; title: string }) => [
            guardFinding.commentId,
            guardFinding,
          ]),
        );
        processedFindings = processedFindings.map((finding) => {
          const kept = guardFindingByCommentId.get(finding.commentId);
          if (!kept) {
            guardrailSuppressed += 1;
            return { ...finding, suppressed: true, filterAction: "guardrail-suppressed" as const, originalTitle: finding.title };
          }
          if (kept.title !== finding.title) {
            guardrailRewritten += 1;
            return { ...finding, title: kept.title, filterAction: "guardrail-rewritten" as const, originalTitle: finding.title };
          }
          return finding;
        });
        if (guardrailSuppressed > 0) {
          audit.push({ action: "guardrail-suppressed", source: "guardrail", count: guardrailSuppressed });
        }
        if (guardrailRewritten > 0) {
          audit.push({ action: "guardrail-rewritten", source: "guardrail", count: guardrailRewritten });
        }
      }
    } catch (guardErr) {
      audit.push({ action: "kept", source: "guardrail", reason: "failed-open" });
      input.logger.warn(
        { ...input.baseLog, err: guardErr },
        "Guardrail pipeline failed (fail-open, existing filter results used)",
      );
    }

    if (input.graphBlastRadius && input.graphValidationEnabled) {
      try {
        const graphValidationInput = processedFindings.map((finding) => ({
          id: finding.commentId,
          filePath: finding.filePath,
          title: finding.title,
          severity: String(finding.severity),
        } satisfies GraphValidationFinding));
        const validateGraphAmplifiedFindings = input.validateGraphAmplifiedFindings ?? defaultValidateGraphAmplifiedFindings;
        const validationResult = await validateGraphAmplifiedFindings(
          graphValidationInput,
          input.graphBlastRadius,
          input.graphValidationLLM ?? null,
          { enabled: true },
          input.logger as never,
        );

        if (validationResult.succeeded && validationResult.validatedCount > 0) {
          audit.push({ action: "graph-validated", source: "graph-validation", count: validationResult.validatedCount });
          input.logger.info(
            {
              ...input.baseLog,
              gate: "graph-amplified-validation",
              validatedCount: validationResult.validatedCount,
              confirmedCount: validationResult.confirmedCount,
              uncertainCount: validationResult.uncertainCount,
            },
            "Graph-amplified finding validation applied",
          );
          const verdictMap = new Map(
            validationResult.findings.map((finding) => [Number(finding.id), {
              graphValidated: finding.graphValidated,
              graphValidationVerdict: finding.graphValidationVerdict,
            }]),
          );
          processedFindings = processedFindings.map((finding) => {
            const verdict = verdictMap.get(finding.commentId);
            if (!verdict) return finding;
            return { ...finding, ...verdict };
          });
        } else if (!validationResult.succeeded) {
          audit.push({ action: "kept", source: "graph-validation", reason: "failed-open" });
          input.logger.warn(
            { ...input.baseLog, gate: "graph-amplified-validation", error: validationResult.errorMessage },
            "Graph-amplified finding validation failed (fail-open, continuing without validation)",
          );
        }
      } catch (validationErr) {
        audit.push({ action: "kept", source: "graph-validation", reason: "failed-open" });
        input.logger.warn(
          { ...input.baseLog, gate: "graph-amplified-validation", err: validationErr },
          "Graph-amplified finding validation threw unexpectedly (fail-open)",
        );
      }
    }

    const recurrenceCounts = new Map<string, number>();
    for (const finding of processedFindings) {
if (finding.suppressed || (typeof finding.confidence === "number" && Number.isFinite(finding.confidence) && finding.confidence < input.minConfidence)) {
        continue;
      }
      const fingerprint = fingerprintFindingTitle(finding.title);
      recurrenceCounts.set(fingerprint, (recurrenceCounts.get(fingerprint) ?? 0) + 1);
    }

    const fileRiskByPath = new Map(input.riskScores.map((risk) => [risk.filePath, risk.score]));
    let visibleFindings = processedFindings.filter((finding) =>
      !finding.suppressed && Number(finding.confidence) >= input.minConfidence
    );

    let prioritizationStats: ReviewReducerPrioritizationStats | undefined;
    if (visibleFindings.length > (input.resolvedMaxComments ?? visibleFindings.length)) {
      const resolvedMaxComments = input.resolvedMaxComments ?? visibleFindings.length;
      const prioritized = prioritizeFindings({
        findings: visibleFindings.map((finding) => {
          const titleFingerprint = fingerprintFindingTitle(finding.title);
          return {
            ...finding,
            severity: String(finding.severity),
            category: String(finding.category),
            fileRiskScore: fileRiskByPath.get(finding.filePath) ?? 0,
            recurrenceCount: recurrenceCounts.get(titleFingerprint) ?? 1,
          };
        }),
        maxComments: resolvedMaxComments,
        weights: input.prioritizationWeights,
      });

      prioritizationStats = {
        ...prioritized.stats,
        maxComments: resolvedMaxComments,
        selectedFindings: prioritized.selectedFindings.length,
        omittedFindings: Math.max(0, visibleFindings.length - prioritized.selectedFindings.length),
      };

      const selectedOriginalIndexes = new Set(
        prioritized.selectedFindings.map((finding) => finding.originalIndex),
      );
      const selectedCommentIds = new Set(
        visibleFindings
          .filter((_, index) => selectedOriginalIndexes.has(index))
          .map((finding) => finding.commentId),
      );

      processedFindings = processedFindings.map((finding) => {
        if (finding.suppressed || Number(finding.confidence) < input.minConfidence) {
          return finding;
        }
        if (selectedCommentIds.has(finding.commentId)) {
          return finding;
        }
        return { ...finding, deprioritized: true };
      });

      audit.push({ action: "deprioritized", source: "finding-prioritizer", count: prioritizationStats.omittedFindings ?? 0 });
      visibleFindings = processedFindings.filter((finding) =>
        !finding.suppressed && !finding.deprioritized && Number(finding.confidence) >= input.minConfidence
      );
    }

    const lowConfidenceFindings = processedFindings.filter((finding) =>
      !finding.suppressed && Number(finding.confidence) < input.minConfidence
    );
    const filteredInlineFindings = processedFindings.filter((finding) =>
      finding.suppressed || Number(finding.confidence) < input.minConfidence || Boolean(finding.deprioritized)
    );

    const counts = buildReviewReducerCounts(processedFindings, audit, { minConfidence: input.minConfidence });
    const result: ReviewReducerResult = {
      status: "ready",
      findings: processedFindings,
      visibleFindings,
      filteredInlineFindings,
      lowConfidenceFindings,
      suppressionMatchCounts,
      filterRecords: filterResult.filtered,
      prioritizationStats,
      counts,
      audit,
      detailsSummary: toReviewReducerDetailsSummary({ status: "ready", counts, repoDoctrine }),
    };

    return result;
  } catch (err) {
    const log = input.logger.error ?? input.logger.warn;
    log({ ...input.baseLog, err }, "Review reducer failed unexpectedly");
    return createDegradedReviewReducerResult({ findings: input.findings, reason: "reducer-exception" });
  }
}

export function toReviewReducerDetailsSummary(resultLike: {
  status: ReviewReducerStatus;
  counts: ReviewReducerCounts;
  reason?: string;
  repoDoctrine?: Partial<RepoDoctrineReducerProjection> | null;
}): ReviewReducerDetailsSummary {
  const { counts } = resultLike;
  const reason = resultLike.status === "degraded"
    ? ` reason=${sanitizeSummaryToken(resultLike.reason ?? "unknown")}`
    : "";
  const repoDoctrine = normalizeRepoDoctrineReducerProjection(resultLike.repoDoctrine);

  return {
    label: "Review reducer",
    status: resultLike.status,
    text: boundSummary([
      `Review reducer: ${resultLike.status}`,
      `input=${formatCount(counts.input)}`,
      `kept=${formatCount(counts.kept)}`,
      `suppressed=${formatCount(counts.suppressed)}`,
      `rewritten=${formatCount(counts.rewritten)}`,
      `deprioritized=${formatCount(counts.deprioritized)}`,
      `lowConfidence=${formatCount(counts.lowConfidence)}`,
      `auditEvents=${formatCount(counts.auditEvents)}`,
      `severityDemoted=${formatCount(counts.severityDemoted)}`,
      `graphValidated=${formatCount(counts.graphValidated)}`,
      `graphUncertain=${formatCount(counts.graphUncertain)}${reason}`,
      `doctrine=${formatRepoDoctrineReducerProjection(repoDoctrine)}`,
    ].join(" ")),
  };
}


function normalizeRepoDoctrineReducerProjection(input: Partial<RepoDoctrineReducerProjection> | null | undefined): RepoDoctrineReducerProjection {
  const status = input?.status === "applied" || input?.status === "degraded" || input?.status === "disabled" || input?.status === "skipped"
    ? input.status
    : "skipped";
  const reasonCodes = Array.isArray(input?.reasonCodes)
    ? input.reasonCodes.map((reason) => sanitizeSummaryToken(String(reason))).filter(Boolean).slice(0, 8)
    : [];
  if (reasonCodes.length === 0) reasonCodes.push(status === "applied" ? "none" : status);
  return {
    status,
    contractCount: normalizeReducerCount(input?.contractCount),
    matchedCount: normalizeReducerCount(input?.matchedCount),
    omittedCount: normalizeReducerCount(input?.omittedCount),
    reasonCodes,
  };
}

function normalizeReducerCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function formatRepoDoctrineReducerProjection(doctrine: RepoDoctrineReducerProjection): string {
  return `${doctrine.status}/${doctrine.contractCount}/${doctrine.matchedCount}/${doctrine.omittedCount} reasons=${doctrine.reasonCodes.slice(0, 4).join(",")}`;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "0";
  }

  return Math.floor(value).toString();
}

function sanitizeSummaryToken(value: string): string {
  const normalized = value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_REASON_LENGTH);

  return normalized || "unknown";
}

function boundSummary(value: string): string {
  return value.length <= MAX_SUMMARY_LENGTH ? value : `${value.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}
