import type { Logger } from "pino";
import type { KnowledgeStore, ReviewRecord } from "../knowledge/types.ts";
import { mapWithConcurrency } from "../lib/concurrency.ts";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";
import {
  fingerprintFindingTitle,
  toConfidenceBand,
  type FindingCategory,
  type FindingSeverity,
} from "../lib/review-finding-metadata.ts";

type ReviewKnowledgeStore = Pick<
  KnowledgeStore,
  "recordReview" | "recordFindings" | "recordSuppressionLog" | "recordGlobalPattern"
>;

const UNSAFE_CONFIG_SNAPSHOT_KEYS = new Set([
  "body",
  "diff",
  "diffContent",
  "prompt",
  "rawBody",
  "rawDiff",
  "rawPrompt",
  "resultText",
]);

export type ReviewKnowledgeConfigSnapshotParams = {
  reviewConfig: {
    mode: string;
    severityMinLevel: string;
    focusAreas: readonly string[];
    maxComments: number;
    suppressionCount: number;
    minConfidence: number;
    profile: string | null | undefined;
  };
  shareGlobal: boolean;
  reviewPlan: unknown;
  reviewReducer: {
    status: string;
    counts: unknown;
    reason?: string;
  };
  reviewCandidateFinding: unknown;
  reviewCandidatePublication: unknown;
  reviewCandidatePublicationFlow: unknown;
};

export type ReviewKnowledgeFinding = {
  commentId?: number;
  filePath: string;
  startLine?: number;
  endLine?: number;
  severity: FindingSeverity;
  category: FindingCategory;
  confidence: number;
  title: string;
  suppressed: boolean;
  suppressionPattern?: string;
};

export type ReviewKnowledgePersistenceResult =
  Result<{ reviewId: number }>;

export type ReviewKnowledgeRecordParams = {
  repo: string;
  prNumber: number;
  headSha: string;
  deliveryId: string;
  filesAnalyzed: number;
  linesChanged: number;
  findingCounts: {
    critical: number;
    major: number;
    medium: number;
    minor: number;
  };
  findingsTotal: number;
  suppressionsApplied: number;
  reviewConfig: ReviewKnowledgeConfigSnapshotParams["reviewConfig"];
  shareGlobal: boolean;
  reviewPlan: unknown;
  reviewReducer: ReviewKnowledgeConfigSnapshotParams["reviewReducer"];
  reviewCandidateFinding: unknown;
  reviewCandidatePublication: unknown;
  reviewCandidatePublicationFlow: unknown;
  durationMs: number | undefined;
  model: string;
  conclusion: string;
};

export type OptionalReviewKnowledgePersistenceParams = Omit<
  Parameters<typeof persistReviewKnowledge>[0],
  "knowledgeStore" | "reviewRecord"
> & {
  knowledgeStore: ReviewKnowledgeStore | undefined;
  record: ReviewKnowledgeRecordParams;
};

function sanitizeConfigSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConfigSnapshotValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_CONFIG_SNAPSHOT_KEYS.has(key)) continue;
    sanitized[key] = sanitizeConfigSnapshotValue(child);
  }
  return sanitized;
}

export function buildReviewKnowledgeConfigSnapshot(
  params: ReviewKnowledgeConfigSnapshotParams,
): string {
  return JSON.stringify({
    mode: params.reviewConfig.mode,
    severityMinLevel: params.reviewConfig.severityMinLevel,
    focusAreas: params.reviewConfig.focusAreas,
    maxComments: params.reviewConfig.maxComments,
    suppressionCount: params.reviewConfig.suppressionCount,
    minConfidence: params.reviewConfig.minConfidence,
    profile: params.reviewConfig.profile,
    shareGlobal: params.shareGlobal,
    reviewPlan: sanitizeConfigSnapshotValue(params.reviewPlan),
    reviewReducer: sanitizeConfigSnapshotValue(params.reviewReducer),
    reviewCandidateFinding: sanitizeConfigSnapshotValue(params.reviewCandidateFinding),
    reviewCandidatePublication: sanitizeConfigSnapshotValue(params.reviewCandidatePublication),
    reviewCandidatePublicationFlow: sanitizeConfigSnapshotValue(params.reviewCandidatePublicationFlow),
  });
}

export function buildReviewKnowledgeRecord(
  params: ReviewKnowledgeRecordParams,
): ReviewRecord {
  return {
    repo: params.repo,
    prNumber: params.prNumber,
    headSha: params.headSha,
    deliveryId: params.deliveryId,
    filesAnalyzed: params.filesAnalyzed,
    linesChanged: params.linesChanged,
    findingsCritical: params.findingCounts.critical,
    findingsMajor: params.findingCounts.major,
    findingsMedium: params.findingCounts.medium,
    findingsMinor: params.findingCounts.minor,
    findingsTotal: params.findingsTotal,
    suppressionsApplied: params.suppressionsApplied,
    configSnapshot: buildReviewKnowledgeConfigSnapshot({
      reviewConfig: params.reviewConfig,
      shareGlobal: params.shareGlobal,
      reviewPlan: params.reviewPlan,
      reviewReducer: params.reviewReducer,
      reviewCandidateFinding: params.reviewCandidateFinding,
      reviewCandidatePublication: params.reviewCandidatePublication,
      reviewCandidatePublicationFlow: params.reviewCandidatePublicationFlow,
    }),
    durationMs: params.durationMs,
    model: params.model,
    conclusion: params.conclusion,
  };
}

export async function persistReviewKnowledge(params: {
  knowledgeStore: ReviewKnowledgeStore;
  logger: Pick<Logger, "debug" | "warn">;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  reviewRecord: ReviewRecord;
  processedFindings: ReviewKnowledgeFinding[];
  suppressionMatchCounts: Map<string, number>;
  visibleFindingCount: number;
  lowConfidenceFindingCount: number;
  suppressionsApplied: number;
  shareGlobal: boolean;
}): Promise<ReviewKnowledgePersistenceResult> {
  const {
    knowledgeStore,
    logger,
    repo,
    prNumber,
    reviewOutputKey,
    reviewRecord,
    processedFindings,
    suppressionMatchCounts,
    visibleFindingCount,
    lowConfidenceFindingCount,
    suppressionsApplied,
    shareGlobal,
  } = params;

  try {
    const reviewId = await knowledgeStore.recordReview(reviewRecord);

    logger.debug(
      {
        reviewId,
        repo,
        prNumber,
        findingsCaptured: processedFindings.length,
      },
      "Knowledge store: review recorded",
    );

    await knowledgeStore.recordFindings(
      processedFindings.map((finding) => ({
        reviewId,
        commentId: finding.commentId,
        commentSurface: "pull_request_review_comment" as const,
        reviewOutputKey,
        filePath: finding.filePath,
        startLine: finding.startLine,
        endLine: finding.endLine,
        severity: finding.severity,
        category: finding.category,
        confidence: finding.confidence,
        title: finding.title,
        suppressed: finding.suppressed,
        suppressionPattern: finding.suppressionPattern,
      })),
    );

    await knowledgeStore.recordSuppressionLog(
      Array.from(suppressionMatchCounts.entries()).map(([pattern, matchedCount]) => ({
        reviewId,
        pattern,
        matchedCount,
      })),
    );

    if (shareGlobal) {
      try {
        const aggregateCounts = new Map<string, {
          severity: FindingSeverity;
          category: FindingCategory;
          confidenceBand: "high" | "medium" | "low";
          patternFingerprint: string;
          count: number;
        }>();

        for (const finding of processedFindings) {
          const confidenceBand = toConfidenceBand(finding.confidence);
          const patternFingerprint = fingerprintFindingTitle(finding.title);
          const key = `${finding.severity}|${finding.category}|${confidenceBand}|${patternFingerprint}`;
          const existing = aggregateCounts.get(key);
          if (existing) {
            existing.count += 1;
            continue;
          }
          aggregateCounts.set(key, {
            severity: finding.severity,
            category: finding.category,
            confidenceBand,
            patternFingerprint,
            count: 1,
          });
        }

        await mapWithConcurrency(
          [...aggregateCounts.values()],
          4,
          (aggregate) => knowledgeStore.recordGlobalPattern({
            severity: aggregate.severity,
            category: aggregate.category,
            confidenceBand: aggregate.confidenceBand,
            patternFingerprint: aggregate.patternFingerprint,
            count: aggregate.count,
          }),
        );
      } catch (err) {
        logger.warn(
          { err, repo, prNumber },
          "Knowledge store global aggregate write failed (non-fatal)",
        );
      }
    }

    logger.debug(
      {
        reviewId,
        repo,
        prNumber,
        visibleFindings: visibleFindingCount,
        lowConfidenceFindings: lowConfidenceFindingCount,
        suppressionsApplied,
      },
      "Knowledge store: findings and suppression logs recorded",
    );

    return resultOk({ reviewId });
  } catch (err) {
    const error = toError(err);
    logger.warn(
      { err: error, repo, prNumber },
      "Knowledge store write failed (non-fatal)",
    );
    return resultErr(error);
  }
}

export async function persistReviewKnowledgeIfAvailable(
  params: OptionalReviewKnowledgePersistenceParams,
): Promise<number | undefined> {
  if (!params.knowledgeStore) return undefined;
  const { knowledgeStore, record, ...persistenceParams } = params;
  const result = await persistReviewKnowledge({
    ...persistenceParams,
    knowledgeStore,
    reviewRecord: buildReviewKnowledgeRecord(record),
  });
  return result.ok ? result.value.reviewId : undefined;
}
