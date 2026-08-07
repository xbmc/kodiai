import { applyEnforcement } from "../enforcement/index.ts";
import type { SemanticGroundingLLM, SemanticGroundingOptions } from "../enforcement/index.ts";
import type { FeedbackSuppressionResult } from "../feedback/index.ts";
import { adjustConfidenceForFeedback } from "../feedback/index.ts";
import { reviewAdapter, type ReviewInput } from "../lib/guardrail/adapters/review-adapter.ts";
import { runGuardrailPipeline as defaultRunGuardrailPipeline } from "../lib/guardrail/pipeline.ts";
import type { GuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import { buildFileDiffsMap, classifyClaims, type FindingClaimClassification, type FindingForClassification } from "../lib/claim-classifier.ts";
import { demoteExternalClaimSeverities, type DemotableFinding } from "../lib/severity-demoter.ts";
import { filterExternalClaims, type FilterableFinding, type FilteredFindingRecord } from "../lib/output-filter.ts";
import { prioritizeFindings, type FindingPriorityWeights } from "../lib/finding-prioritizer.ts";
import { computeConfidence, createSuppressionMatcher, type SuppressionPattern } from "../knowledge/confidence.ts";
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

// Re-exported so existing importers keep a single entry point for the reducer.
export type {
  ProcessedReviewFinding,
  RepoDoctrineReducerProjection,
  RepoDoctrineReducerStatus,
  ReviewReducerAuditEvent,
  ReviewReducerCounts,
  ReviewReducerDetailsSummary,
  ReviewReducerFindingAction,
  ReviewReducerInput,
  ReviewReducerPrioritizationStats,
  ReviewReducerResult,
  ReviewReducerStatus,
} from "./review-reducer-types.ts";
export { toReviewReducerDetailsSummary } from "./review-reducer-summary.ts";

import type {
  CountOptions,
  DegradedReviewReducerInput,
  EnforcedExtractedFinding,
  ProcessedReviewFinding,
  RepoDoctrineReducerProjection,
  ReviewReducerAuditEvent,
  ReviewReducerCounts,
  ReviewReducerInput,
  ReviewReducerPrioritizationStats,
  ReviewReducerResult,
  ReviewReducerStatus,
} from "./review-reducer-types.ts";
import {
  normalizeRepoDoctrineReducerProjection,
  sanitizeSummaryToken,
  toReviewReducerDetailsSummary,
} from "./review-reducer-summary.ts";
import {
  severityBeforeGates,
  wasDowngradedByGate,
  type GateAdjustedFinding,
  type GateOutcome,
  type SeverityGate,
} from "../enforcement/gate-outcome.ts";

/** Log message per gate for the downgrade audit pass below. */
const GATE_DOWNGRADE_LOG_MESSAGES: ReadonlyArray<readonly [SeverityGate, string]> = [
  ["diff-grounding", "Diff grounding downgraded findings with unverifiable file:line citations"],
  ["semantic-grounding", "Semantic grounding downgraded findings whose reasoning did not match the actual code"],
];


// 40 keeps every severity/category combination from computeConfidence visible
// (the lowest, minor+documentation, scores exactly 40). The old default of 50
// silently dropped all minor style/documentation findings even under the
// strict profile, which promises minor-level findings.
const DEFAULT_MIN_CONFIDENCE = 40;
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

    if (finding.severityDemoted === true || wasDowngradedByGate(finding)) {
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
          diffText: input.diffContent,
          semanticGroundingLLM: input.semanticGroundingLLM,
          semanticGroundingOptions: input.semanticGroundingOptions,
          logger: input.logger,
        }) as unknown as EnforcedExtractedFinding[]
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

    // One pass over every gate's downgrades. Adding a gate needs no change here.
    for (const [gate, message] of GATE_DOWNGRADE_LOG_MESSAGES) {
      const downgrades = enforcedFindings.flatMap((finding) =>
        (finding.gateOutcomes ?? []).filter((outcome) => outcome.gate === gate && outcome.from !== undefined)
      );
      if (downgrades.length === 0) continue;
      audit.push({ action: "severity-demoted", source: "enforcement", count: downgrades.length });
      input.logger.info(
        {
          ...input.baseLog,
          gate,
          downgradedCount: downgrades.length,
          reasons: downgrades.map((outcome) => outcome.reason).slice(0, 20),
        },
        message,
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

    let externalClaimCount = 0;
    let mixedClaimCount = 0;
    for (const classification of claimClassificationMap.values()) {
      if (classification?.summaryLabel === "primarily-external") externalClaimCount++;
      if (classification?.summaryLabel === "mixed") mixedClaimCount++;
    }
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

    const suppressionMatchers = input.reviewSuppressions.map((suppression) => ({
      suppression,
      matches: createSuppressionMatcher(suppression),
    }));
    const feedbackPatternByFingerprint = new Map(
      input.feedbackSuppression.patterns.map((pattern) => [pattern.fingerprint, pattern]),
    );
    const suppressionMatchCounts = new Map<string, number>();
    let processedFindings: ProcessedReviewFinding[] = enforcedFindings.map((finding) => {
      const category = finding.category as FindingCategory;
      const suppressionFinding = {
        filePath: finding.filePath,
        title: finding.title,
        severity: finding.severity as FindingSeverity,
        category,
      };
      const matchedSuppression = suppressionMatchers.find(({ matches }) =>
        matches(suppressionFinding)
      );
      const dedupSuppressed = input.priorFindingContext
        ? shouldSuppressFinding({
            filePath: finding.filePath,
            titleFingerprint: fingerprintFindingTitle(finding.title),
            suppressionFingerprints: input.priorFindingContext.suppressionFingerprints,
          })
        : false;
      // The gates promise "never drop, downgrade instead" -- but their
      // downgrade target is `medium`, which is exactly what abbreviated-tier
      // suppression and the minConfidence floor drop. Judging both on the
      // pre-gate severity keeps a downgrade a demotion rather than a deletion.
      const preGroundingEffectiveSeverity = severityBeforeGates(
        finding as typeof finding & { severity: FindingSeverity },
      );
      const abbreviatedSuppressed = abbreviatedFileSet.has(finding.filePath)
        && (preGroundingEffectiveSeverity === "medium" || preGroundingEffectiveSeverity === "minor");
      const titleFp = fingerprintFindingTitle(finding.title);
      const feedbackSuppressed = input.feedbackSuppression.suppressedFingerprints.has(titleFp);
      const suppressed = finding.toolingSuppressed || Boolean(matchedSuppression) || dedupSuppressed || abbreviatedSuppressed || feedbackSuppressed;
      const suppressionPattern = matchedSuppression
        ? typeof matchedSuppression.suppression === "string"
          ? matchedSuppression.suppression
          : matchedSuppression.suppression.pattern
        : undefined;
      if (suppressionPattern) {
        suppressionMatchCounts.set(suppressionPattern, (suppressionMatchCounts.get(suppressionPattern) ?? 0) + 1);
      }

      const feedbackPattern = feedbackPatternByFingerprint.get(titleFp);
      // Same "never drop" reasoning as abbreviatedSuppressed above: findings
      // below `minConfidence` are filtered out of visibleFindings entirely, so
      // scoring confidence off the downgraded severity would let a grounding
      // downgrade remove the finding rather than merely demote it.
      const baseConfidence = computeConfidence({
        severity: preGroundingEffectiveSeverity as FindingSeverity,
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
    // Findings without a numeric confidence pass the filter: Number(undefined)
    // is NaN and NaN >= min is always false, which used to silently drop them.
    const passesConfidence = (finding: ProcessedReviewFinding): boolean =>
      typeof finding.confidence !== "number"
      || !Number.isFinite(finding.confidence)
      || finding.confidence >= input.minConfidence;
    let visibleFindings = processedFindings.filter((finding) =>
      !finding.suppressed && passesConfidence(finding)
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
        if (finding.suppressed || !passesConfidence(finding)) {
          return finding;
        }
        if (selectedCommentIds.has(finding.commentId)) {
          return finding;
        }
        return { ...finding, deprioritized: true };
      });

      audit.push({ action: "deprioritized", source: "finding-prioritizer", count: prioritizationStats.omittedFindings ?? 0 });
      visibleFindings = processedFindings.filter((finding) =>
        !finding.suppressed && !finding.deprioritized && passesConfidence(finding)
      );
    }

    const lowConfidenceFindings = processedFindings.filter((finding) =>
      !finding.suppressed && !passesConfidence(finding)
    );
    const filteredInlineFindings = processedFindings.filter((finding) =>
      finding.suppressed || !passesConfidence(finding) || Boolean(finding.deprioritized)
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

