/**
 * Pure utility functions extracted from src/handlers/review.ts.
 *
 * All functions here take explicit parameters and have no closure over
 * handler state. This is a light extraction per DECISIONS.md
 * ("M026: Light extraction only for review.ts/mention.ts").
 */

import {
  buildKeywordParsingSection,
  DEFAULT_EMPTY_INTENT,
  type ParsedPRIntent,
} from "../lib/pr-intent-parser.ts";
import type { ResolvedReviewProfile } from "../lib/auto-profile.ts";
import type { MergeConfidence } from "../lib/merge-confidence.ts";
import type { ContributorExperienceReviewDetailsProjection } from "../contributor/experience-contract.ts";
import { SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE } from "../execution/review-prompt.ts";
import type { ReviewPhaseName, ReviewPhaseStatus, ReviewPhaseTiming } from "../execution/types.ts";
import { buildStructuralImpactSection } from "./structural-impact-formatter.ts";
import { summarizeStructuralImpactDegradation } from "../structural-impact/degradation.ts";
import type { StructuralImpactPayload } from "../structural-impact/types.ts";
import type { ReviewBoundednessContract } from "./review-boundedness.ts";
import type { ReviewFirstPassPayload } from "./review-first-pass.ts";
import type { ReviewPlanDetailsSummary, RepoDoctrinePlanProjection } from "../review-orchestration/review-plan.ts";
import type { ReviewReducerDetailsSummary } from "../review-orchestration/review-reducer.ts";
import type { ReviewCandidateFindingDetailsSummary } from "../review-orchestration/review-candidate-finding.ts";
import type { ReviewCandidatePublicationRuntimeDetailsSummary } from "../review-orchestration/review-candidate-publication-runtime.ts";
import type { ReviewFindingLifecyclePublicProjection } from "../review-lifecycle/finding-lifecycle.ts";
import type { ValidationTruthProjection } from "../review-lifecycle/validation-truth.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewArea = "security" | "correctness" | "performance" | "style" | "documentation";
export type FindingSeverity = "critical" | "major" | "medium" | "minor";
export type FindingCategory = "security" | "correctness" | "performance" | "style" | "documentation";
export type ConfidenceBand = "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SEARCH_RATE_LIMIT_ERROR_MARKERS = [
  "rate limit",
  "secondary rate limit",
  "abuse detection",
  "too many requests",
];
export const SEARCH_RATE_LIMIT_BACKOFF_MAX_MS = 1_500;
export const SEARCH_RATE_LIMIT_DISCLOSURE_LINE = `> ${SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE}`;

export const PROFILE_PRESETS: Record<string, {
  severityMinLevel: FindingSeverity;
  maxComments: number;
  ignoredAreas: ReviewArea[];
  focusAreas: ReviewArea[];
}> = {
  strict: {
    severityMinLevel: "minor",
    maxComments: 15,
    ignoredAreas: [],
    focusAreas: [],
  },
  balanced: {
    severityMinLevel: "medium",
    maxComments: 7,
    ignoredAreas: ["style"],
    focusAreas: [],
  },
  minimal: {
    severityMinLevel: "major",
    maxComments: 3,
    ignoredAreas: ["style", "documentation"],
    focusAreas: ["security", "correctness"],
  },
};

const REVIEW_DETAILS_PHASE_ORDER = [
  "queue wait",
  "workspace preparation",
  "retrieval/context assembly",
  "executor handoff",
  "remote runtime",
  "publication",
] as const satisfies ReadonlyArray<ReviewPhaseName>;

export type ReviewDetailsPhaseTimingSummary = {
  totalDurationMs?: number;
  phases?: ReadonlyArray<ReviewPhaseTiming> | null;
};

export type TimeoutReviewDetailsProgress = {
  analyzedFiles: number;
  totalFiles: number;
  findingCount: number;
  retryState: string;
};

export type TimeoutBudgetDetails = {
  remoteRuntimeBudgetSeconds: number;
  infraOverheadBudgetSeconds: number;
  totalTimeoutSeconds: number;
};

export type ReviewDetailsLineCountSource = "local-diff" | "github-pr-api-fallback";


export type ReviewPlanReviewDetailsFormatterSummary = {
  gate?: unknown;
  planHash?: unknown;
  route?: { kind?: unknown; taskType?: unknown; routingReason?: unknown } | null;
  scope?: {
    changedFileCount?: unknown;
    reviewedFileCount?: unknown;
    totalLinesChanged?: unknown;
    representativePaths?: unknown;
    omittedPathCount?: unknown;
  } | null;
  contextSources?: {
    totalCount?: unknown;
    totalItemCount?: unknown;
    statusCounts?: unknown;
    representatives?: unknown;
    omittedSourceCount?: unknown;
  } | null;
  gates?: {
    totalCount?: unknown;
    totalFindingCount?: unknown;
    statusCounts?: unknown;
    representatives?: unknown;
    omittedGateCount?: unknown;
  } | null;
  budgets?: { maxComments?: unknown; maxTurns?: unknown; timeoutSeconds?: unknown; tokenBudget?: unknown } | null;
  publishPolicy?: {
    mode?: unknown;
    autoApprove?: unknown;
    publishReviewDetails?: unknown;
    inlineComments?: unknown;
    candidateVerificationRequired?: unknown;
  } | null;
  repoDoctrine?: Partial<RepoDoctrinePlanProjection> | null;
};


export type CandidatePublicationBridgeReviewDetails = {
  bridgeVersion?: unknown;
  bridgeId?: unknown;
  recordKey?: unknown;
  correlationKey?: unknown;
  status?: unknown;
  sourceLabel?: unknown;
  candidateRef?: unknown;
  verificationState?: unknown;
  counts?: unknown;
  presence?: unknown;
  reasonCategories?: unknown;
  malformedReasonCodes?: unknown;
  redaction?: unknown;
  reducerHandoffAvailable?: unknown;
};

export type CandidateVerificationPublicationEvidenceReviewDetails = {
  aggregateStatus?: unknown;
  counts?: unknown;
  publicationDenialCounts?: unknown;
  reasonCategories?: unknown;
  verificationStateCounts?: unknown;
  candidateVerificationCounts?: unknown;
  metadata?: unknown;
  redactionFlags?: unknown;
};

function boundedReviewDetailsValue(value: unknown, maxLength = 160): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return null;
  }
  const text = String(value).trim();
  if (!text) return null;
  return text.replace(/[\r\n|]/g, " ").slice(0, maxLength);
}

function readNonNegativeCount(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function formatCountFields(value: unknown, keys: readonly string[]): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return keys.map((key) => `${key}:${readNonNegativeCount(record, key)}`).join(",");
}

function formatStringArray(value: unknown, maxItems = 8): string {
  if (!Array.isArray(value)) return "none";
  const entries = value
    .map((entry) => boundedReviewDetailsValue(entry, 64))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, maxItems);
  return entries.length > 0 ? entries.join(",") : "none";
}

function formatReasonCountFields(value: unknown, maxItems = 8): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "none";
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, count]) => {
      const boundedKey = boundedReviewDetailsValue(key, 64);
      if (!boundedKey || typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
      return `${boundedKey}:${Math.trunc(count)}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, maxItems);
  return entries.length > 0 ? entries.join(",") : "none";
}

function formatCandidateVerificationMetadata(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "deliveryId:n,reviewOutputKey:n,correlationKey:n";
  }
  const metadata = value as Record<string, unknown>;
  const parts = [
    `deliveryId:${metadata.hasDeliveryId === true ? "y" : "n"}`,
    `reviewOutputKey:${metadata.hasReviewOutputKey === true ? "y" : "n"}`,
    `correlationKey:${metadata.hasCorrelationKey === true ? "y" : "n"}`,
  ];
  return parts.join(",");
}

function formatRedactionFlags(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "privateOnly:y,raw:n,evidencePayloads:n,publicationEvidence:n";
  }
  const flags = value as Record<string, unknown>;
  return [
    `privateOnly:${flags.privateOnly === false ? "n" : "y"}`,
    `candidateBodies:${flags.candidateBodiesIncluded === true ? "y" : "n"}`,
    `specialistProse:${flags.specialistProseIncluded === true ? "y" : "n"}`,
    `rawPrompts:${flags.rawPromptsIncluded === true ? "y" : "n"}`,
    `rawModelOutput:${flags.rawModelOutputIncluded === true ? "y" : "n"}`,
    `diffs:${flags.diffsIncluded === true ? "y" : "n"}`,
    `evidencePayloads:${flags.evidencePayloadsIncluded === true ? "y" : "n"}`,
    `rawFingerprints:${flags.rawFingerprintsIncluded === true ? "y" : "n"}`,
    `publicationEvidence:${flags.publicationEvidenceIncluded === true ? "y" : "n"}`,
    `unsafeFields:${readNonNegativeCount(flags, "unsafeInputFieldCount")}`,
  ].join(",");
}


const REVIEW_PLAN_DETAILS_MAX_VALUE_LENGTH = 80;
const REVIEW_PLAN_DETAILS_MAX_LIST_ITEMS = 4;
const REVIEW_PLAN_DETAILS_FORBIDDEN_VALUE = "[redacted]";

function sanitizeReviewPlanDetailsValue(value: unknown, maxLength = REVIEW_PLAN_DETAILS_MAX_VALUE_LENGTH): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const normalized = String(value).replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (/prompt|model|raw[-_ ]?diff|secret|token|api[-_ ]?key|password/i.test(normalized)) {
    return REVIEW_PLAN_DETAILS_FORBIDDEN_VALUE;
  }
  return normalized.slice(0, maxLength);
}

function sanitizeReviewPlanDetailsCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function sanitizeReviewPlanDetailsBoolean(value: unknown): "y" | "n" {
  return value === true ? "y" : "n";
}

function formatReviewPlanDetailsStatusCounts(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "none";
  const record = value as Record<string, unknown>;
  return ["enabled", "applied", "skipped", "unavailable"]
    .map((status) => `${status}:${sanitizeReviewPlanDetailsCount(record[status])}`)
    .join(",");
}

function formatReviewPlanDetailsRepresentativeList(
  value: unknown,
  options: { kind: "context" | "gate" | "path" },
): string {
  if (!Array.isArray(value)) return "none";
  const entries = value.slice(0, REVIEW_PLAN_DETAILS_MAX_LIST_ITEMS).map((entry) => {
    if (options.kind === "path") return sanitizeReviewPlanDetailsValue(entry, 48);
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    const name = sanitizeReviewPlanDetailsValue(record.name, 36);
    const status = sanitizeReviewPlanDetailsValue(record.status, 20);
    if (!name || !status) return null;
    if (options.kind === "context") {
      return `${name}:${status}:${sanitizeReviewPlanDetailsCount(record.itemCount)}`;
    }
    const findingCount = record.findingCount === undefined ? undefined : `:${sanitizeReviewPlanDetailsCount(record.findingCount)}`;
    return `${name}:${status}${findingCount ?? ""}`;
  }).filter((entry): entry is string => Boolean(entry));
  return entries.length > 0 ? entries.join(",") : "none";
}

function formatReviewPlanDoctrineDetails(summary?: Partial<RepoDoctrinePlanProjection> | null): string {
  if (typeof summary !== "object" || summary === null || Array.isArray(summary)) {
    return "skipped/0/0/0 reasons=skipped";
  }
  const statusRaw = sanitizeReviewPlanDetailsValue(summary.status, 24) ?? "skipped";
  const status = ["disabled", "skipped", "degraded", "applied"].includes(statusRaw) ? statusRaw : "degraded";
  const allReasons = Array.isArray(summary.reasonCodes)
    ? summary.reasonCodes.map((reason) => sanitizeReviewPlanDetailsValue(reason, 48)).filter((reason): reason is string => Boolean(reason))
    : [];
  const reasons = allReasons.slice(0, 6);
  if (reasons.length === 0) reasons.push(status === "applied" ? "none" : status);
  const omittedReasons = Math.max(0, allReasons.length - reasons.length);
  const reasonText = omittedReasons > 0 ? `${reasons.join(",")} +${omittedReasons} omitted` : reasons.join(",");
  return `${status}/${sanitizeReviewPlanDetailsCount(summary.contractCount)}/${sanitizeReviewPlanDetailsCount(summary.matchedCount)}/${sanitizeReviewPlanDetailsCount(summary.omittedCount)} reasons=${reasonText}`;
}

function formatReviewPlanReviewDetailsLine(summary?: ReviewPlanReviewDetailsFormatterSummary | null): string | null {
  try {
    if (typeof summary !== "object" || summary === null || Array.isArray(summary)) return null;
    const planHash = sanitizeReviewPlanDetailsValue(summary.planHash, 96);
    if (!planHash) return null;
    const route = typeof summary.route === "object" && summary.route !== null && !Array.isArray(summary.route) ? summary.route : {};
    const scope = typeof summary.scope === "object" && summary.scope !== null && !Array.isArray(summary.scope) ? summary.scope : {};
    const contexts = typeof summary.contextSources === "object" && summary.contextSources !== null && !Array.isArray(summary.contextSources) ? summary.contextSources : {};
    const gates = typeof summary.gates === "object" && summary.gates !== null && !Array.isArray(summary.gates) ? summary.gates : {};
    const budgets = typeof summary.budgets === "object" && summary.budgets !== null && !Array.isArray(summary.budgets) ? summary.budgets : {};
    const publishPolicy = typeof summary.publishPolicy === "object" && summary.publishPolicy !== null && !Array.isArray(summary.publishPolicy) ? summary.publishPolicy : {};
    const repoDoctrine = typeof summary.repoDoctrine === "object" && summary.repoDoctrine !== null && !Array.isArray(summary.repoDoctrine) ? summary.repoDoctrine : null;

    const routeParts = [
      sanitizeReviewPlanDetailsValue(route.kind, 32) ?? "unknown",
      sanitizeReviewPlanDetailsValue(route.taskType, 48),
      sanitizeReviewPlanDetailsValue(route.routingReason, 48),
    ].filter((part): part is string => Boolean(part));

    const omittedPaths = sanitizeReviewPlanDetailsCount(scope.omittedPathCount);
    const omittedSources = sanitizeReviewPlanDetailsCount(contexts.omittedSourceCount);
    const omittedGates = sanitizeReviewPlanDetailsCount(gates.omittedGateCount);
    const omittedSuffix = (count: number) => count > 0 ? ` +${count} omitted` : "";

    return [
      `- Review Plan: hash=${planHash}`,
      `route=${routeParts.join("/")}`,
      `scope=${sanitizeReviewPlanDetailsCount(scope.changedFileCount)} changed/${sanitizeReviewPlanDetailsCount(scope.reviewedFileCount)} reviewed/${sanitizeReviewPlanDetailsCount(scope.totalLinesChanged)} lines; paths=${formatReviewPlanDetailsRepresentativeList(scope.representativePaths, { kind: "path" })}${omittedSuffix(omittedPaths)}`,
      `contexts=${sanitizeReviewPlanDetailsCount(contexts.totalCount)} sources/${sanitizeReviewPlanDetailsCount(contexts.totalItemCount)} items/${formatReviewPlanDetailsStatusCounts(contexts.statusCounts)}; reps=${formatReviewPlanDetailsRepresentativeList(contexts.representatives, { kind: "context" })}${omittedSuffix(omittedSources)}`,
      `gates=${sanitizeReviewPlanDetailsCount(gates.totalCount)} gates/${sanitizeReviewPlanDetailsCount(gates.totalFindingCount)} findings/${formatReviewPlanDetailsStatusCounts(gates.statusCounts)}; reps=${formatReviewPlanDetailsRepresentativeList(gates.representatives, { kind: "gate" })}${omittedSuffix(omittedGates)}`,
      `budget=maxComments:${sanitizeReviewPlanDetailsCount(budgets.maxComments)},maxTurns:${sanitizeReviewPlanDetailsCount(budgets.maxTurns)},timeoutSeconds:${sanitizeReviewPlanDetailsCount(budgets.timeoutSeconds)},tokenBudget:${sanitizeReviewPlanDetailsCount(budgets.tokenBudget)}`,
      `publish=${sanitizeReviewPlanDetailsValue(publishPolicy.mode, 32) ?? "unknown"},autoApprove:${sanitizeReviewPlanDetailsBoolean(publishPolicy.autoApprove)},details:${sanitizeReviewPlanDetailsBoolean(publishPolicy.publishReviewDetails)},inline:${sanitizeReviewPlanDetailsBoolean(publishPolicy.inlineComments)},candidateVerification:${sanitizeReviewPlanDetailsBoolean(publishPolicy.candidateVerificationRequired)}`,
      `doctrine=${formatReviewPlanDoctrineDetails(repoDoctrine)}`,
    ].join("; ");
  } catch {
    return null;
  }
}

function formatReviewPlanDetailsLine(reviewPlan?: ReviewPlanDetailsSummary | null): string[] {
  try {
    const text = typeof reviewPlan?.text === "string"
      ? reviewPlan.text.trim().replace(/\s+/g, " ")
      : "";
    return text ? [`- ${text}`] : [];
  } catch {
    return [];
  }
}

function formatReviewReducerDetailsLine(reviewReducer?: ReviewReducerDetailsSummary | null): string[] {
  try {
    const text = typeof reviewReducer?.text === "string"
      ? reviewReducer.text.trim().replace(/\s+/g, " ")
      : "";
    return text ? [`- ${text}`] : [];
  } catch {
    return [];
  }
}

export function formatReviewCandidateFindingDetailsLine(
  reviewCandidateFinding?: ReviewCandidateFindingDetailsSummary | null,
): string[] {
  try {
    if (reviewCandidateFinding?.label !== "Review candidates") return [];
    if (
      reviewCandidateFinding.status !== "shadow"
      && reviewCandidateFinding.status !== "unavailable"
      && reviewCandidateFinding.status !== "degraded"
    ) {
      return [];
    }

    const text = typeof reviewCandidateFinding.text === "string"
      ? sanitizeReviewCandidateDetailsText(reviewCandidateFinding.text)
      : "";
    if (!text || !text.startsWith("Review candidates:")) return [];
    return [`- ${text}`];
  } catch {
    return [];
  }
}

function sanitizeReviewCandidateDetailsText(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/system prompt|hidden instructions/gi, "prompt-redacted")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 260);
}

const REVIEW_CANDIDATE_PUBLICATION_MODES = new Set([
  "candidate-approved",
  "candidate-approved-partial",
  "moved-to-details",
  "direct-fallback",
  "fallback-disallowed",
  "blocked",
  "degraded",
]);
const MAX_REVIEW_CANDIDATE_PUBLICATION_REASONS = 6;
const MAX_REVIEW_CANDIDATE_PUBLICATION_BUCKETS = 8;
const MAX_REVIEW_CANDIDATE_PUBLICATION_BUCKET_REASONS = 8;
const MAX_REVIEW_CANDIDATE_DETAILS_ONLY_FINDINGS = 5;
const MAX_REVIEW_CANDIDATE_DETAILS_ONLY_EXCERPT_LENGTH = 160;

export function formatReviewCandidatePublicationDetailsLine(
  reviewCandidatePublication?: ReviewCandidatePublicationRuntimeDetailsSummary | null,
): string[] {
  try {
    if (!reviewCandidatePublication) return [];
    if (reviewCandidatePublication.label !== "Review candidate publication runtime") return [];
    if (typeof reviewCandidatePublication.text !== "string" || reviewCandidatePublication.text.trim().length === 0) {
      return [formatMalformedReviewCandidatePublicationDetailsLine()];
    }

    const normalized = normalizeReviewCandidatePublicationDetailsText(reviewCandidatePublication.text, reviewCandidatePublication);
    if (!normalized) return [formatMalformedReviewCandidatePublicationDetailsLine()];
    return [`- ${normalized}`, ...formatReviewCandidateMovedToDetailsLines(reviewCandidatePublication)];
  } catch {
    return [formatMalformedReviewCandidatePublicationDetailsLine()];
  }
}

function normalizeReviewCandidatePublicationDetailsText(
  value: string,
  reviewCandidatePublication?: ReviewCandidatePublicationRuntimeDetailsSummary,
): string | null {
  const text = sanitizeReviewCandidatePublicationDetailsText(value);
  const match = text.match(/^Review candidate publication runtime:\s+(\S+)\s*/);
  if (!match) return null;

  const rawMode = sanitizeReviewCandidatePublicationToken(match[1] ?? "degraded");
  const mode = REVIEW_CANDIDATE_PUBLICATION_MODES.has(rawMode) ? rawMode : "degraded";
  const approved = extractCandidatePublicationCount(text, "approvedRefs");
  const rewritten = extractCandidatePublicationCount(text, "rewrittenRefs");
  const published = extractCandidatePublicationCount(text, "candidatePublished");
  const movedToDetails = extractCandidatePublicationCount(text, "movedToDetails");
  const detailsOmitted = extractCandidatePublicationCount(text, "detailsOmitted");
  const directFallback = Math.max(
    extractCandidatePublicationCount(text, "fallbackEvidence"),
    extractCandidatePublicationCount(text, "directPublished"),
  );
  const reasons = formatReviewCandidatePublicationReasons(text);
  const buckets = formatReviewCandidatePublicationOutcomeBuckets(reviewCandidatePublication);

  return `Review candidate publication: mode=${mode} approved=${approved} rewritten=${rewritten} published=${published} directFallback=${directFallback} reasons=${reasons} movedToDetails=${movedToDetails} detailsOmitted=${detailsOmitted}${buckets ? ` buckets=${buckets}` : ""}`;
}


function formatReviewCandidatePublicationOutcomeBuckets(
  reviewCandidatePublication?: ReviewCandidatePublicationRuntimeDetailsSummary,
): string | null {
  const rawBuckets = (reviewCandidatePublication as { outcomeBuckets?: unknown } | undefined)?.outcomeBuckets;
  if (typeof rawBuckets !== "object" || rawBuckets === null || Array.isArray(rawBuckets)) return null;

  const entries: string[] = [];
  let omittedReasons = 0;
  const orderedKeys = ["published", "skipped", "blocked", "failed", "movedToDetails", "directFallback", "fallbackDisallowed", "degraded"] as const;
  for (const key of orderedKeys) {
    if (entries.length >= MAX_REVIEW_CANDIDATE_PUBLICATION_BUCKETS) break;
    const bucket = (rawBuckets as Record<string, unknown>)[key];
    if (typeof bucket !== "object" || bucket === null || Array.isArray(bucket)) continue;
    const record = bucket as Record<string, unknown>;
    const count = readNonNegativeCount(record, "count");
    if (count <= 0) continue;
    const mode = sanitizeReviewCandidatePublicationBucketMode(record.mode, key);
    const rawReasons = Array.isArray(record.reasons) ? record.reasons : [];
    const safeReasons = rawReasons
      .map((reason) => typeof reason === "string" ? sanitizeReviewCandidatePublicationToken(reason) : "")
      .filter(isSafeReviewCandidatePublicationBucketReason);
    if (mode !== "degraded") {
      omittedReasons += Math.max(0, rawReasons.length - safeReasons.length);
    }
    const cappedReasons = safeReasons.slice(0, MAX_REVIEW_CANDIDATE_PUBLICATION_BUCKET_REASONS);
    omittedReasons += Math.max(0, safeReasons.length - cappedReasons.length);
    entries.push(`${mode}:${count}:${cappedReasons.length > 0 ? cappedReasons.join("+") : "unknown-safe-reason"}`);
  }

  if (entries.length === 0) return null;
  return `${entries.join(",")}${omittedReasons > 0 ? ` +${omittedReasons} bucketReasonsOmitted` : ""}`;
}

function sanitizeReviewCandidatePublicationBucketMode(value: unknown, key: string): string {
  const mode = typeof value === "string" ? sanitizeReviewCandidatePublicationToken(value) : "";
  if (mode) return mode;
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function isSafeReviewCandidatePublicationBucketReason(value: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(value)) return false;
  return !/(redacted|prompt|diff|token|secret|unsafe|raw|canary|hidden)/.test(value);
}

function formatReviewCandidateMovedToDetailsLines(
  reviewCandidatePublication: ReviewCandidatePublicationRuntimeDetailsSummary,
): string[] {
  try {
    if (!hasSafeMovedToDetailsRedaction(reviewCandidatePublication.movedToDetails)) return [];
    const findings = Array.isArray(reviewCandidatePublication.detailsOnlyFindings)
      ? reviewCandidatePublication.detailsOnlyFindings
      : [];
    if (findings.length === 0) return [];

    const rendered = findings
      .map(formatReviewCandidateMovedFindingLine)
      .filter((line): line is string => Boolean(line))
      .slice(0, MAX_REVIEW_CANDIDATE_DETAILS_ONLY_FINDINGS);
    if (rendered.length === 0) return [];

    const total = readNonNegativeCount(reviewCandidatePublication.movedToDetails?.counts ?? {}, "total");
    const explicitOmitted = readNonNegativeCount(reviewCandidatePublication.movedToDetails?.counts ?? {}, "omitted");
    const omitted = Math.max(0, total - rendered.length, explicitOmitted, findings.length - rendered.length);
    return [
      "- Moved review candidates preserved in details:",
      ...rendered,
      ...(omitted > 0 ? [`  - ...and ${omitted} more omitted (bounded-details-only)`] : []),
    ];
  } catch {
    return [];
  }
}

function hasSafeMovedToDetailsRedaction(summary: ReviewCandidatePublicationRuntimeDetailsSummary["movedToDetails"]): boolean {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
  const redaction = summary.redaction;
  if (typeof redaction !== "object" || redaction === null || Array.isArray(redaction)) return false;
  return redaction.rawCandidatePayloadsIncluded === false
    && redaction.rawPromptsIncluded === false
    && redaction.rawModelOutputIncluded === false
    && redaction.diffsIncluded === false
    && redaction.replacementTextIncluded === false
    && redaction.githubResponsePayloadsIncluded === false
    && redaction.secretLikeValuesIncluded === false
    && redaction.bounded === true;
}

function formatReviewCandidateMovedFindingLine(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const finding = value as Record<string, unknown>;
  const location = typeof finding.location === "object" && finding.location !== null && !Array.isArray(finding.location)
    ? finding.location as Record<string, unknown>
    : null;
  if (!location) return null;

  const title = sanitizeMovedDetailsText(finding.title, 96) ?? "Untitled finding";
  const severity = sanitizeReviewCandidatePublicationToken(String(finding.severity ?? "medium"));
  const category = sanitizeReviewCandidatePublicationToken(String(finding.category ?? "correctness"));
  const path = sanitizeMovedDetailsPath(location.path);
  const line = readPositiveInteger(location.line);
  const reason = sanitizeReviewCandidatePublicationToken(String(finding.reason ?? "unknown-safe-reason")) || "unknown-safe-reason";
  if (!path || !line) return null;

  const excerpt = sanitizeMovedDetailsText(finding.excerpt, MAX_REVIEW_CANDIDATE_DETAILS_ONLY_EXCERPT_LENGTH);
  return `  - [${severity}/${category}] ${title} (${path}:${line}, reason=${reason})${excerpt ? ` — ${excerpt}` : ""}`;
}

function sanitizeMovedDetailsPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\\/g, "/").replace(/^b\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || /^[a-zA-Z]:[\\/]/.test(normalized)) return null;
  return sanitizeMovedDetailsText(normalized, 160);
}

function sanitizeMovedDetailsText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const normalized = String(value)
    .replace(/```suggestion[\s\S]*?```/gi, "[fix-redacted]")
    .replace(/diff --git[\s\S]*/gi, "diff-redacted")
    .replace(/BEGIN\s+PROMPT[\s\S]*/gi, "prompt-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/system prompt|hidden instructions/gi, "prompt-redacted")
    .replace(/TOKEN\s*[:=]\s*[^\s]+/gi, "token-redacted")
    .replace(/secret\s*[:=]\s*[^\s]+/gi, "secret-redacted")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/AKIA[0-9A-Z]{16}/g, "redacted")
    .replace(/[\r\n|\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.trunc(value) : null;
}

function formatMalformedReviewCandidatePublicationDetailsLine(): string {
  return "- Review candidate publication: mode=degraded approved=0 rewritten=0 published=0 directFallback=0 reasons=malformed-runtime-summary movedToDetails=0 detailsOmitted=0 buckets=degraded:1:malformed-runtime-summary";
}

function extractCandidatePublicationCount(text: string, key: string): number {
  const match = text.match(new RegExp(`(?:^|\\s)${key}=(-?\\d+)`));
  if (!match) return 0;
  const value = Number.parseInt(match[1] ?? "0", 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatReviewCandidatePublicationReasons(text: string): string {
  const marker = "reasons=";
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return "none";

  const reasonText = text.slice(markerIndex + marker.length).trim();
  if (!reasonText || reasonText === "none") return "none";

  const reasons = reasonText
    .split(",")
    .map((reason) => sanitizeReviewCandidatePublicationToken(reason))
    .filter((reason) => reason.length > 0);

  if (reasons.length === 0) return "none";

  const cappedReasons = reasons.slice(0, MAX_REVIEW_CANDIDATE_PUBLICATION_REASONS);
  const remaining = reasons.length - cappedReasons.length;
  return remaining > 0 ? `${cappedReasons.join(",")} +${remaining} more` : cappedReasons.join(",");
}

function sanitizeReviewCandidatePublicationDetailsText(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/system prompt|hidden instructions/gi, "prompt-redacted")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 1_000);
}

function sanitizeReviewCandidatePublicationToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function boundedBridgeToken(value: unknown, fallback = "unavailable", maxLength = 160): string {
  const text = boundedReviewDetailsValue(value, maxLength);
  if (!text || !/^[a-z0-9][a-z0-9:._-]*$/.test(text)) return fallback;
  return text;
}

function formatBridgeStringArray(value: unknown, maxItems = 8): string {
  if (!Array.isArray(value)) return "none";
  const entries = value
    .map((entry) => boundedBridgeToken(entry, "", 64))
    .filter((entry) => entry.length > 0)
    .slice(0, maxItems);
  return entries.length > 0 ? entries.join(",") : "none";
}

function hasUnsafeBridgeRedaction(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
  const redaction = value as Record<string, unknown>;
  return redaction.privateOnly !== true
    || redaction.rawPayloadsIncluded !== false
    || redaction.publicationFieldsIncluded !== false
    || redaction.evidencePayloadsIncluded !== false
    || redaction.githubCommentBodyIncluded !== false
    || redaction.reducerHandoffIncludesRawPayload !== false;
}

function formatBridgeRedactionFlags(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "privateOnly:n,rawPayloads:n,publicationFields:n,evidencePayloads:n,githubCommentBody:n,reducerRawPayload:n,discardedRawPayload:n,discardedPublicationFields:n,discardedEvidencePayloads:n";
  }
  const redaction = value as Record<string, unknown>;
  return [
    `privateOnly:${redaction.privateOnly === true ? "y" : "n"}`,
    `rawPayloads:${redaction.rawPayloadsIncluded === true ? "y" : "n"}`,
    `publicationFields:${redaction.publicationFieldsIncluded === true ? "y" : "n"}`,
    `evidencePayloads:${redaction.evidencePayloadsIncluded === true ? "y" : "n"}`,
    `githubCommentBody:${redaction.githubCommentBodyIncluded === true ? "y" : "n"}`,
    `reducerRawPayload:${redaction.reducerHandoffIncludesRawPayload === true ? "y" : "n"}`,
    `discardedRawPayload:${redaction.discardedRawPayload === true ? "y" : "n"}`,
    `discardedPublicationFields:${redaction.discardedPublicationFields === true ? "y" : "n"}`,
    `discardedEvidencePayloads:${redaction.discardedEvidencePayloads === true ? "y" : "n"}`,
  ].join(",");
}

function formatBridgePresence(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "deliveryId:n,reviewOutputKey:n,upstreamCorrelationKey:n,policyCorrelationKey:n";
  }
  const presence = value as Record<string, unknown>;
  return [
    `deliveryId:${presence.hasDeliveryId === true ? "y" : "n"}`,
    `reviewOutputKey:${presence.hasReviewOutputKey === true ? "y" : "n"}`,
    `upstreamCorrelationKey:${presence.hasUpstreamCorrelationKey === true ? "y" : "n"}`,
    `policyCorrelationKey:${presence.hasPolicyCorrelationKey === true ? "y" : "n"}`,
  ].join(",");
}

function formatCandidatePublicationBridgeLine(
  bridge?: CandidatePublicationBridgeReviewDetails | null,
): string | null {
  if (bridge === undefined || bridge === null) return null;
  if (typeof bridge !== "object" || Array.isArray(bridge)) {
    return "- M072 candidate publication bridge: status=unavailable; reasons=malformed-bridge-projection; handoffOwner=unavailable; redaction=privateOnly:y,rawPayloads:n,publicationFields:n,evidencePayloads:n,githubCommentBody:n,reducerRawPayload:n,discardedRawPayload:n,discardedPublicationFields:n,discardedEvidencePayloads:n";
  }

  const status = boundedBridgeToken(bridge.status, "unavailable", 32);
  const validStatus = status === "allowed" || status === "denied" || status === "malformed" || status === "unavailable";
  const unsafeRedaction = hasUnsafeBridgeRedaction(bridge.redaction);
  if (!validStatus || unsafeRedaction) {
    return `- M072 candidate publication bridge: status=unavailable; reasons=${unsafeRedaction ? "unsafe-redaction-flags" : "malformed-bridge-projection"}; handoffOwner=unavailable; redaction=${formatBridgeRedactionFlags(bridge.redaction)}`;
  }

  const counts = formatCountFields(bridge.counts, [
    "candidateCount",
    "evidenceCount",
    "verifiedCount",
    "partiallyVerifiedCount",
    "unverifiedCount",
    "disprovenCount",
    "publicationEligibleCount",
    "malformedRecordCount",
    "unsafeInputFieldCount",
  ]) ?? "candidateCount:0,evidenceCount:0,verifiedCount:0,partiallyVerifiedCount:0,unverifiedCount:0,disprovenCount:0,publicationEligibleCount:0,malformedRecordCount:0,unsafeInputFieldCount:0";
  const handoffOwner = bridge.reducerHandoffAvailable === true ? "available" : "unavailable";

  return [
    `- M072 candidate publication bridge: status=${status}`,
    `bridgeVersion=${boundedBridgeToken(bridge.bridgeVersion)}`,
    `bridgeId=${boundedBridgeToken(bridge.bridgeId)}`,
    `recordKey=${boundedBridgeToken(bridge.recordKey)}`,
    `correlationKey=${boundedBridgeToken(bridge.correlationKey)}`,
    `source=${boundedBridgeToken(bridge.sourceLabel)}`,
    `candidateRef=${boundedBridgeToken(bridge.candidateRef)}`,
    `verification=${bridge.verificationState === null ? "none" : boundedBridgeToken(bridge.verificationState, "unavailable", 32)}`,
    `counts=${counts}`,
    `reasons=${formatBridgeStringArray(bridge.reasonCategories)}`,
    `malformed=${formatBridgeStringArray(bridge.malformedReasonCodes)}`,
    `presence=${formatBridgePresence(bridge.presence)}`,
    `handoffOwner=${handoffOwner}`,
    `redaction=${formatBridgeRedactionFlags(bridge.redaction)}`,
  ].join("; ");
}

function formatCandidateVerificationPublicationEvidenceLine(
  evidence?: CandidateVerificationPublicationEvidenceReviewDetails | null,
): string | null {
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) {
    return null;
  }

  const status = boundedReviewDetailsValue(evidence.aggregateStatus, 32) ?? "unavailable";
  const counts = formatCountFields(evidence.counts, ["attempted", "allowed", "denied", "published", "skipped", "failed"]);
  if (!counts) return null;
  const verification = formatCountFields(evidence.verificationStateCounts, ["verified", "partially_verified", "unverified", "disproven", "unavailable"])
    ?? "verified:0,partially_verified:0,unverified:0,disproven:0,unavailable:0";
  const candidateCounts = formatCountFields(evidence.candidateVerificationCounts, ["candidateCount", "evidenceCount", "verifiedCount", "partiallyVerifiedCount", "unverifiedCount", "disprovenCount", "publicationEligibleCount"])
    ?? "candidateCount:0,evidenceCount:0,verifiedCount:0,partiallyVerifiedCount:0,unverifiedCount:0,disprovenCount:0,publicationEligibleCount:0";

  return `- M070 candidate verification publication: status=${status}; counts=${counts}; verification=${verification}; candidateVerification=${candidateCounts}; denialCounts=${formatReasonCountFields(evidence.publicationDenialCounts)}; reasons=${formatStringArray(evidence.reasonCategories)}; metadata=${formatCandidateVerificationMetadata(evidence.metadata)}; redaction=${formatRedactionFlags(evidence.redactionFlags)}`;
}


const REVIEW_VALIDATION_TRUTH_REASON_ORDER = [
  "suggested-but-open",
  "validation-missing",
  "validation-passed",
  "validation-failed",
  "validation-stale",
  "revalidation-missing",
  "revalidation-passed",
  "revalidation-failed",
  "degraded",
  "blocked",
  "resolved",
] as const;
const REVIEW_VALIDATION_TRUTH_MAX_REASONS = 8;
const REVIEW_VALIDATION_TRUTH_MAX_REFERENCES = 5;

function hasUnsafeValidationTruthRedaction(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
  const redaction = value as Record<string, unknown>;
  return redaction.privateOnly !== true
    || redaction.rawPromptsIncluded !== false
    || redaction.rawModelOutputIncluded !== false
    || redaction.candidateBodiesIncluded !== false
    || redaction.replacementTextIncluded !== false
    || redaction.toolPayloadsIncluded !== false
    || redaction.secretLikeStringsIncluded !== false
    || redaction.diffsIncluded !== false
    || redaction.unboundedArraysIncluded !== false;
}

function formatValidationTruthReasonCounts(value: unknown, omittedValue: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "none";
  const record = value as Record<string, unknown>;
  const entries = REVIEW_VALIDATION_TRUTH_REASON_ORDER
    .map((reason) => {
      const count = record[reason];
      if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
      return `${reason}:${Math.trunc(count)}`;
    })
    .filter((entry): entry is string => Boolean(entry));
  if (entries.length === 0) return "none";

  const capped = entries.slice(0, REVIEW_VALIDATION_TRUTH_MAX_REASONS);
  const omitted = Math.max(
    0,
    entries.length - capped.length + (typeof omittedValue === "number" && Number.isFinite(omittedValue) && omittedValue > 0 ? Math.trunc(omittedValue) : 0),
  );
  return omitted > 0 ? `${capped.join(",")} +${omitted} omitted` : capped.join(",");
}

function formatValidationTruthReferences(value: unknown, omittedValue: unknown): string {
  if (!Array.isArray(value)) return "none";
  const entries = value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const id = boundedBridgeToken(record.id, "", 48);
      const status = boundedBridgeToken(record.status, "", 24);
      if (!id || !["open", "suggested", "uncertain", "blocked", "degraded", "resolved"].includes(status)) return null;
      const reasons = Array.isArray(record.reasonCodes)
        ? record.reasonCodes
            .map((reason) => boundedBridgeToken(reason, "", 40))
            .filter((reason) => (REVIEW_VALIDATION_TRUTH_REASON_ORDER as readonly string[]).includes(reason))
            .slice(0, 3)
            .join("+")
        : "none";
      return `${id}:${status}:${reasons || "none"}:fix:${record.hasSuggestedFix === true ? "y" : "n"}:validation:${record.validationPresent === true ? "y" : "n"}:revalidation:${record.revalidationPresent === true ? "y" : "n"}`;
    })
    .filter((entry): entry is string => Boolean(entry));

  if (entries.length === 0) return "none";
  const capped = entries.slice(0, REVIEW_VALIDATION_TRUTH_MAX_REFERENCES);
  const omitted = Math.max(
    0,
    entries.length - capped.length + (typeof omittedValue === "number" && Number.isFinite(omittedValue) && omittedValue > 0 ? Math.trunc(omittedValue) : 0),
  );
  return omitted > 0 ? `${capped.join(",")} +${omitted} omitted` : capped.join(",");
}

function formatValidationTruthRedaction(value: unknown): string {
  const redaction = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return [
    "privateOnly:y",
    "rawPrompts:n",
    "rawModelOutput:n",
    "candidateBodies:n",
    "replacementText:n",
    "toolPayloads:n",
    "secretLike:n",
    "diffs:n",
    "unboundedArrays:n",
    `unsafeFields:${readNonNegativeCount(redaction, "unsafeInputFieldCount")}`,
  ].join(",");
}

function formatReviewValidationTruthDetailsLine(
  validationTruth?: ValidationTruthProjection | null,
): string | null {
  try {
    if (typeof validationTruth !== "object" || validationTruth === null || Array.isArray(validationTruth)) return null;
    if (validationTruth.schema !== "review-validation-truth.v1") return null;
    if (validationTruth.gate !== "review-validation-truth") return null;
    const status = boundedBridgeToken(validationTruth.status, "unavailable", 32);
    if (status !== "empty" && status !== "normalized" && status !== "degraded") return null;
    if (hasUnsafeValidationTruthRedaction(validationTruth.redaction)) return null;

    const counts = formatCountFields(validationTruth.counts, [
      "detected",
      "suggested",
      "validated",
      "revalidated",
      "resolved",
      "blocked",
      "degraded",
      "open",
      "uncertain",
      "inputFindings",
      "unsafeInputFields",
    ]) ?? "detected:0,suggested:0,validated:0,revalidated:0,resolved:0,blocked:0,degraded:0,open:0,uncertain:0,inputFindings:0,unsafeInputFields:0";
    const freshness = formatCountFields(validationTruth.evidenceFreshness, [
      "fresh",
      "stale",
      "missingValidation",
      "missingRevalidation",
    ]) ?? "fresh:0,stale:0,missingValidation:0,missingRevalidation:0";
    const omitted = typeof validationTruth.omitted === "object" && validationTruth.omitted !== null && !Array.isArray(validationTruth.omitted)
      ? validationTruth.omitted as Record<string, unknown>
      : {};
    const correlation = [
      `reviewOutputKey:${boundedReviewDetailsValue(validationTruth.reviewOutputKey, 96) ? "y" : "n"}`,
      `deliveryId:${boundedReviewDetailsValue(validationTruth.deliveryId, 96) ? "y" : "n"}`,
    ].join(",");

    return [
      `- Review validation truth: status=${status}`,
      `counts=${counts}`,
      `evidence=${freshness}`,
      `reasons=${formatValidationTruthReasonCounts(validationTruth.reasonCounts, omitted.reasonCodes)}`,
      `refs=${formatValidationTruthReferences(validationTruth.references, omitted.references)}`,
      `correlation=${correlation}`,
      `redaction=${formatValidationTruthRedaction(validationTruth.redaction)}`,
    ].join("; ");
  } catch {
    return null;
  }
}

function formatReviewFindingLifecycleDetailsLine(
  lifecycle?: ReviewFindingLifecyclePublicProjection | null,
): string | null {
  try {
    if (typeof lifecycle !== "object" || lifecycle === null || Array.isArray(lifecycle)) return null;
    if (lifecycle.schema !== "review-finding-lifecycle.v1") return null;
    const status = boundedBridgeToken(lifecycle.status, "unavailable", 32);
    if (status !== "normalized" && status !== "degraded" && status !== "unavailable") return null;

    const redaction = typeof lifecycle.redaction === "object" && lifecycle.redaction !== null && !Array.isArray(lifecycle.redaction)
      ? lifecycle.redaction as Record<string, unknown>
      : null;
    if (
      !redaction
      || redaction.privateOnly !== true
      || redaction.rawPromptsIncluded !== false
      || redaction.rawModelOutputIncluded !== false
      || redaction.candidateBodiesIncluded !== false
      || redaction.toolPayloadsIncluded !== false
      || redaction.secretLikeStringsIncluded !== false
      || redaction.diffsIncluded !== false
      || redaction.unboundedArraysIncluded !== false
    ) {
      return null;
    }

    const counts = formatCountFields(lifecycle.counts, ["input", "recorded", "rejected", "unsafeInputFields"])
      ?? "input:0,recorded:0,rejected:0,unsafeInputFields:0";
    const statusCounts = formatCountFields(lifecycle.counts?.status, ["detected", "open", "suggested", "validated", "revalidated", "resolved", "blocked", "degraded"])
      ?? "detected:0,open:0,suggested:0,validated:0,revalidated:0,resolved:0,blocked:0,degraded:0";
    const severityCounts = formatCountFields(lifecycle.counts?.severity, ["critical", "major", "medium", "minor"])
      ?? "critical:0,major:0,medium:0,minor:0";
    const actionabilityCounts = formatCountFields(lifecycle.counts?.actionability, ["actionable", "needs-human-review", "needs-reproduction", "blocked", "not-actionable"])
      ?? "actionable:0,needs-human-review:0,needs-reproduction:0,blocked:0,not-actionable:0";
    const correlation = typeof lifecycle.correlation === "object" && lifecycle.correlation !== null && !Array.isArray(lifecycle.correlation)
      ? lifecycle.correlation as Record<string, unknown>
      : {};
    const correlationText = [
      `repo:${correlation.repoPresent === true ? "y" : "n"}`,
      `pull:${correlation.pullNumberPresent === true ? "y" : "n"}`,
      `reviewOutputKey:${correlation.reviewOutputKeyPresent === true ? "y" : "n"}`,
      `deliveryId:${correlation.deliveryIdPresent === true ? "y" : "n"}`,
      `commit:${correlation.commitIdentityPresent === true ? "y" : "n"}`,
    ].join(",");

    const redactionText = [
      "privateOnly:y",
      "rawPrompts:n",
      "rawModelOutput:n",
      "candidateBodies:n",
      "toolPayloads:n",
      "secretLike:n",
      "diffs:n",
      "unboundedArrays:n",
      `unsafeFields:${readNonNegativeCount(redaction, "unsafeInputFieldCount")}`,
    ].join(",");

    return [
      `- Review finding lifecycle: status=${status}`,
      `counts=${counts}`,
      `correlation=${correlationText}`,
      `statuses=${statusCounts}`,
      `severity=${severityCounts}`,
      `actionability=${actionabilityCounts}`,
      `reasons=${formatStringArray(lifecycle.reasonCodes, 8)}`,
      `rejected=${formatStringArray(lifecycle.rejectedReasonCodes, 8)}`,
      `redaction=${redactionText}`,
    ].join("; ");
  } catch {
    return null;
  }
}

export type ReviewRetryFailureClassification = {
  category: "retry-infra-failure" | "retry-execution-failure";
  reason: "workspace-prep-terminated" | "unknown";
};

export function resolveReviewDetailsLineCounts(params: {
  diffLinesAdded: number;
  diffLinesRemoved: number;
  prApiLinesAdded?: number;
  prApiLinesRemoved?: number;
}): {
  linesAdded: number;
  linesRemoved: number;
  source: ReviewDetailsLineCountSource;
} {
  const diffLinesAdded = Math.max(0, params.diffLinesAdded);
  const diffLinesRemoved = Math.max(0, params.diffLinesRemoved);
  const prApiLinesAdded = Math.max(0, params.prApiLinesAdded ?? 0);
  const prApiLinesRemoved = Math.max(0, params.prApiLinesRemoved ?? 0);

  if (diffLinesAdded + diffLinesRemoved === 0 && prApiLinesAdded + prApiLinesRemoved > 0) {
    return {
      linesAdded: prApiLinesAdded,
      linesRemoved: prApiLinesRemoved,
      source: "github-pr-api-fallback",
    };
  }

  return {
    linesAdded: diffLinesAdded,
    linesRemoved: diffLinesRemoved,
    source: "local-diff",
  };
}

export function classifyRetryFailure(err: unknown): ReviewRetryFailureClassification {
  const exitCode = typeof err === "object" && err !== null
    ? (err as { exitCode?: unknown }).exitCode
    : undefined;
  const message = err instanceof Error ? err.message : String(err);

  if (exitCode === 143 || exitCode === "143" || /exit code 143|sigterm/i.test(message)) {
    return { category: "retry-infra-failure", reason: "workspace-prep-terminated" };
  }

  return { category: "retry-execution-failure", reason: "unknown" };
}

function formatBoundedReason(reason: ReviewFirstPassPayload["boundedReason"]): string {
  if (reason === "max-turns") {
    return "max-turns";
  }
  if (reason === "large-pr") {
    return "large-PR triage";
  }
  return "timeout";
}

function formatEvidenceSource(source: ReviewFirstPassPayload["evidenceSource"]): string {
  if (source === "checkpoint") {
    return "checkpoint evidence";
  }
  if (source === "boundedness") {
    return "boundedness evidence";
  }
  return "no trustworthy evidence";
}

function formatTimeoutSuffix(
  timedOutAfterSeconds?: number,
  timeoutBudget?: TimeoutBudgetDetails | null,
): string {
  if (timeoutBudget) {
    return ` (timeout budget: remote runtime ${timeoutBudget.remoteRuntimeBudgetSeconds}s + infra overhead ${timeoutBudget.infraOverheadBudgetSeconds}s = total ${timeoutBudget.totalTimeoutSeconds}s)`;
  }

  return typeof timedOutAfterSeconds === "number" ? ` (${timedOutAfterSeconds}s timeout)` : "";
}

function formatCoverageClause(firstPass: ReviewFirstPassPayload, evidenceLabel: string): string {
  if (firstPass.coveredScope) {
    return `after covering ${firstPass.coveredScope.reviewedFiles} of ${firstPass.coveredScope.totalFiles} files from ${evidenceLabel}`;
  }

  return `using ${evidenceLabel}`;
}

function formatRemainingScopeSummary(firstPass: ReviewFirstPassPayload): string {
  if (firstPass.remainingScope) {
    return `${firstPass.remainingScope.remainingFiles} of ${firstPass.remainingScope.totalFiles} files remain unreviewed`;
  }

  if (firstPass.continuationPending) {
    return "remaining scope is not confirmed from structured evidence";
  }

  return "remaining scope is not confirmed from structured evidence";
}

function formatContinuationSummary(firstPass: ReviewFirstPassPayload): string {
  if (firstPass.continuationPending) {
    return "follow-up review is pending";
  }

  return "no follow-up review is pending";
}

function formatContinuationDetail(firstPass: ReviewFirstPassPayload): string {
  if (firstPass.state === "zero-evidence-failure") {
    return "- Continuation state: stopped after first pass; no follow-up review is pending";
  }

  if (firstPass.continuationPending) {
    if (firstPass.remainingScope) {
      return "- Continuation state: follow-up review pending for remaining scope";
    }

    return "- Continuation state: follow-up review pending; remaining scope still unconfirmed";
  }

  if (firstPass.remainingScope) {
    return `- Continuation state: stopped after first pass; ${firstPass.remainingScope.remainingFiles}/${firstPass.remainingScope.totalFiles} files remain unreviewed`;
  }

  return "- Continuation state: stopped after first pass; no follow-up review is pending";
}

export function buildReviewFirstPassPublicSummary(
  firstPass: ReviewFirstPassPayload,
  timedOutAfterSeconds?: number,
  timeoutBudget?: TimeoutBudgetDetails | null,
): string {
  const reasonLabel = formatBoundedReason(firstPass.boundedReason);
  const evidenceLabel = formatEvidenceSource(firstPass.evidenceSource);

  if (firstPass.state === "zero-evidence-failure") {
    return `hit ${reasonLabel} with no trustworthy structured evidence${formatTimeoutSuffix(
      firstPass.boundedReason === "timeout" ? timedOutAfterSeconds : undefined,
      firstPass.boundedReason === "timeout" ? timeoutBudget : undefined,
    )}`;
  }

  return [
    `stopped at ${reasonLabel} ${formatCoverageClause(firstPass, evidenceLabel)}`,
    formatRemainingScopeSummary(firstPass),
    `${formatContinuationSummary(firstPass)}${formatTimeoutSuffix(
      firstPass.boundedReason === "timeout" ? timedOutAfterSeconds : undefined,
      firstPass.boundedReason === "timeout" ? timeoutBudget : undefined,
    )}`,
  ].join("; ");
}

export function describeReviewFirstPass(firstPass: ReviewFirstPassPayload): {
  reasonLabel: string;
  evidenceLabel: string;
  summaryClause: (
    timedOutAfterSeconds?: number,
    timeoutBudget?: TimeoutBudgetDetails | null,
  ) => string;
  detailLines: string[];
} {
  const reasonLabel = formatBoundedReason(firstPass.boundedReason);
  const evidenceLabel = formatEvidenceSource(firstPass.evidenceSource);

  const summaryClause = (
    timedOutAfterSeconds?: number,
    timeoutBudget?: TimeoutBudgetDetails | null,
  ): string => {
    return buildReviewFirstPassPublicSummary(
      firstPass,
      timedOutAfterSeconds,
      timeoutBudget,
    );
  };

  if (firstPass.state === "zero-evidence-failure") {
    return {
      reasonLabel,
      evidenceLabel,
      summaryClause,
      detailLines: [
        `- Constrained outcome: zero-evidence hard failure after ${reasonLabel}`,
        "- Publication eligibility: ineligible",
        formatContinuationDetail(firstPass),
      ],
    };
  }

  const detailLines = [
    `- Bounded first-pass: ${reasonLabel} via ${evidenceLabel}`,
    ...(firstPass.coveredScope
      ? [`- Covered scope: ${firstPass.coveredScope.reviewedFiles}/${firstPass.coveredScope.totalFiles} changed files`]
      : []),
    ...(firstPass.inspectedScope
      ? [`- Inspected before ${reasonLabel}: ${firstPass.inspectedScope.inspectedFiles}/${firstPass.inspectedScope.totalFiles} changed files`]
      : []),
    ...(firstPass.remainingScope
      ? [`- Remaining scope: ${firstPass.remainingScope.remainingFiles}/${firstPass.remainingScope.totalFiles} changed files`]
      : ["- Remaining scope: not confirmed from structured evidence"]),
    ...(typeof firstPass.findingCount === "number"
      ? [`- First-pass findings captured: ${firstPass.findingCount}`]
      : []),
    `- Publication eligibility: ${firstPass.publication.eligible ? "eligible" : "ineligible"}`,
    ...(firstPass.publication.hasPublishedOutput ? ["- Public review output already exists for this first pass"] : []),
    formatContinuationDetail(firstPass),
  ];

  return {
    reasonLabel,
    evidenceLabel,
    summaryClause,
    detailLines,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function ensureSearchRateLimitDisclosureInSummary(summaryBody: string): string {
  if (summaryBody.includes(SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE)) {
    return summaryBody;
  }

  const closingTag = "</details>";
  const lastCloseIdx = summaryBody.lastIndexOf(closingTag);

  if (lastCloseIdx === -1) {
    return `${summaryBody}\n\n${SEARCH_RATE_LIMIT_DISCLOSURE_LINE}`;
  }

  const before = summaryBody.slice(0, lastCloseIdx).trimEnd();
  const after = summaryBody.slice(lastCloseIdx);
  return `${before}\n\n${SEARCH_RATE_LIMIT_DISCLOSURE_LINE}\n\n${after}`;
}

export function extractSearchErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function extractSearchErrorText(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";

  const message = (err as { message?: unknown }).message;
  const responseData = (err as { response?: { data?: { message?: unknown } } }).response?.data;
  const responseMessage = responseData && typeof responseData === "object"
    ? (responseData as { message?: unknown }).message
    : undefined;

  const parts = [message, responseMessage]
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.toLowerCase());

  return parts.join(" ");
}

export function isSearchRateLimitError(err: unknown): boolean {
  const status = extractSearchErrorStatus(err);
  const text = extractSearchErrorText(err);
  return (status === 403 || status === 429)
    && SEARCH_RATE_LIMIT_ERROR_MARKERS.some((marker) => text.includes(marker));
}

export function resolveRateLimitBackoffMs(err: unknown): number {
  if (typeof err !== "object" || err === null) return 0;

  const headers = (err as { response?: { headers?: Record<string, unknown> } }).response?.headers;
  if (!headers) return 0;

  const retryAfterRaw = headers["retry-after"];
  if (typeof retryAfterRaw === "string") {
    const retryAfterSeconds = Number.parseInt(retryAfterRaw, 10);
    if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds >= 0) {
      return Math.min(retryAfterSeconds * 1000, SEARCH_RATE_LIMIT_BACKOFF_MAX_MS);
    }
  }

  const resetRaw = headers["x-ratelimit-reset"];
  if (typeof resetRaw === "string") {
    const resetSeconds = Number.parseInt(resetRaw, 10);
    if (!Number.isNaN(resetSeconds)) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const deltaMs = Math.max(0, (resetSeconds - nowSeconds) * 1000);
      return Math.min(deltaMs, SEARCH_RATE_LIMIT_BACKOFF_MAX_MS);
    }
  }

  return 250;
}

export function toConfidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 75) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

export function fingerprintFindingTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");

  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const unsigned = hash >>> 0;
  return `fp-${unsigned.toString(16).padStart(8, "0")}`;
}

export function buildReviewDetailsMarker(reviewOutputKey: string): string {
  return `<!-- kodiai:review-details:${reviewOutputKey} -->`;
}

export function parseSeverityCountsFromBody(body: string): {
  critical: number;
  major: number;
  medium: number;
  minor: number;
} {
  const countMatches = (tag: string) => {
    const regex = new RegExp(`\\[${tag}\\]`, 'gi');
    return (body.match(regex) || []).length;
  };
  return {
    critical: countMatches('CRITICAL'),
    major: countMatches('MAJOR'),
    medium: countMatches('MEDIUM'),
    minor: countMatches('MINOR'),
  };
}

function isFiniteNonNegativeDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isReviewDetailsPhaseName(value: unknown): value is ReviewPhaseName {
  return typeof value === "string"
    && (REVIEW_DETAILS_PHASE_ORDER as ReadonlyArray<string>).includes(value);
}

function isReviewDetailsPhaseStatus(value: unknown): value is ReviewPhaseStatus {
  return value === "completed" || value === "degraded" || value === "unavailable";
}

function formatReviewDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  if (durationMs < 60_000) {
    return `${Math.round(durationMs / 1000)}s`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function normalizeReviewDetailsPhase(phase: unknown): ReviewPhaseTiming | null {
  if (typeof phase !== "object" || phase === null) {
    return null;
  }

  const candidate = phase as {
    name?: unknown;
    status?: unknown;
    durationMs?: unknown;
    detail?: unknown;
  };

  if (!isReviewDetailsPhaseName(candidate.name)) {
    return null;
  }

  if (!isReviewDetailsPhaseStatus(candidate.status)) {
    return {
      name: candidate.name,
      status: "unavailable",
      detail: "invalid phase timing data",
    };
  }

  const detail = typeof candidate.detail === "string" && candidate.detail.trim().length > 0
    ? candidate.detail.trim()
    : undefined;

  if (candidate.status === "unavailable") {
    return {
      name: candidate.name,
      status: "unavailable",
      ...(detail ? { detail } : {}),
    };
  }

  if (!isFiniteNonNegativeDuration(candidate.durationMs)) {
    return {
      name: candidate.name,
      status: "unavailable",
      detail: "invalid phase timing data",
    };
  }

  return {
    name: candidate.name,
    status: candidate.status,
    durationMs: candidate.durationMs,
    ...(detail ? { detail } : {}),
  };
}

function formatReviewDetailsPhaseLine(phase: ReviewPhaseTiming): string {
  if (phase.status === "unavailable") {
    return `  - ${phase.name}: unavailable${phase.detail ? ` (${phase.detail})` : ""}`;
  }

  const durationText = isFiniteNonNegativeDuration(phase.durationMs)
    ? formatReviewDuration(phase.durationMs)
    : "unavailable";

  if (phase.status === "degraded") {
    return `  - ${phase.name}: ${durationText}${phase.detail ? ` (degraded: ${phase.detail})` : " (degraded)"}`;
  }

  return `  - ${phase.name}: ${durationText}`;
}

function formatReviewDetailsPhaseTimingSummary(summary?: ReviewDetailsPhaseTimingSummary | null): string[] {
  if (!summary) {
    return [];
  }

  const phaseMap = new Map<ReviewPhaseName, ReviewPhaseTiming>();
  if (Array.isArray(summary.phases)) {
    for (const phase of summary.phases) {
      const normalized = normalizeReviewDetailsPhase(phase);
      if (normalized && !phaseMap.has(normalized.name)) {
        phaseMap.set(normalized.name, normalized);
      }
    }
  }

  const lines: string[] = [];
  if (isFiniteNonNegativeDuration(summary.totalDurationMs)) {
    lines.push(`- Total wall-clock: ${formatReviewDuration(summary.totalDurationMs)}`);
  }

  lines.push("- Phase timings:");

  for (const name of REVIEW_DETAILS_PHASE_ORDER) {
    const phase = phaseMap.get(name) ?? {
      name,
      status: "unavailable",
      detail: "phase timing unavailable",
    } satisfies ReviewPhaseTiming;
    lines.push(formatReviewDetailsPhaseLine(phase));
  }

  return lines;
}

export function formatReviewDetailsSummary(params: {
  reviewOutputKey: string;
  filesReviewed: number;
  linesAdded: number;
  linesRemoved: number;
  findingCounts: {
    critical: number;
    major: number;
    medium: number;
    minor: number;
  };
  largePRTriage?: {
    fullCount: number;
    abbreviatedCount: number;
    mentionOnlyFiles: Array<{ filePath: string; score: number }>;
    totalFiles: number;
  };
  reviewBoundedness?: ReviewBoundednessContract | null;
  reviewFirstPass?: ReviewFirstPassPayload | null;
  feedbackSuppressionCount?: number;
  keywordParsing?: ParsedPRIntent;
  profileSelection: ResolvedReviewProfile;
  contributorExperience: ContributorExperienceReviewDetailsProjection;
  shadowSpecialistReviewDetails?: {
    readonly reviewDetailsLine: string;
  } | null;
  candidateVerificationPublicationEvidence?: CandidateVerificationPublicationEvidenceReviewDetails | null;
  candidatePublicationBridge?: CandidatePublicationBridgeReviewDetails | null;
  reviewPlanSummary?: ReviewPlanReviewDetailsFormatterSummary | null;
  reviewPlan?: ReviewPlanDetailsSummary | null;
  reviewReducer?: ReviewReducerDetailsSummary | null;
  reviewCandidateFinding?: ReviewCandidateFindingDetailsSummary | null;
  reviewCandidatePublication?: ReviewCandidatePublicationRuntimeDetailsSummary | null;
  reviewFindingLifecycle?: ReviewFindingLifecyclePublicProjection | null;
  reviewValidationTruth?: ValidationTruthProjection | null;
  prioritization?: {
    findingsScored: number;
    topScore: number | null;
    thresholdScore: number | null;
    maxComments?: number;
    selectedFindings?: number;
    omittedFindings?: number;
  };
  usageLimit?: {
    utilization: number | undefined;
    rateLimitType: string | undefined;
    resetsAt: number | undefined;
  };
  tokenUsage?: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    costUsd: number | undefined;
  };
  structuralImpact?: StructuralImpactPayload | null;
  phaseTimingSummary?: ReviewDetailsPhaseTimingSummary | null;
  timeoutProgress?: TimeoutReviewDetailsProgress | null;
  timeoutBudget?: TimeoutBudgetDetails | null;
  lineCountSource?: ReviewDetailsLineCountSource;
  completedAt?: string;
}): string {
  const {
    reviewOutputKey,
    filesReviewed,
    linesAdded,
    linesRemoved,
    findingCounts,
    largePRTriage,
    reviewBoundedness,
    reviewFirstPass,
    feedbackSuppressionCount,
    keywordParsing,
    profileSelection,
    contributorExperience,
    shadowSpecialistReviewDetails,
    candidateVerificationPublicationEvidence,
    candidatePublicationBridge,
    reviewPlanSummary,
    reviewPlan,
    reviewReducer,
    reviewCandidateFinding,
    reviewCandidatePublication,
    reviewFindingLifecycle,
    reviewValidationTruth,
    prioritization,
    usageLimit,
    tokenUsage,
    structuralImpact,
    phaseTimingSummary,
    timeoutProgress,
    timeoutBudget,
    lineCountSource = "local-diff",
  } = params;

  const formatProfileLine = (label: string, profile: ResolvedReviewProfile): string => {
    if (profile.source === "auto") {
      return `- ${label}: ${profile.selectedProfile} (auto, lines changed: ${profile.linesChanged})`;
    }

    if (profile.source === "manual") {
      return `- ${label}: ${profile.selectedProfile} (manual config)`;
    }

    return `- ${label}: ${profile.selectedProfile} (keyword override)`;
  };

  const profileLine = profileSelection.source === "auto"
    ? `- Profile: ${profileSelection.selectedProfile} (auto, lines changed: ${profileSelection.linesChanged})`
    : profileSelection.source === "manual"
      ? `- Profile: ${profileSelection.selectedProfile} (manual config)`
      : `- Profile: ${profileSelection.selectedProfile} (keyword override)`;
  const hasBoundedProfileDetails = Boolean(reviewBoundedness && reviewBoundedness.reasonCodes.length > 0);

  const primaryReviewDetailLines = reviewFirstPass
    ? describeReviewFirstPass(reviewFirstPass).detailLines
    : timeoutProgress
      ? []
      : [
          `- Files reviewed: ${filesReviewed}`,
          `- Findings: ${findingCounts.critical} critical, ${findingCounts.major} major, ${findingCounts.medium} medium, ${findingCounts.minor} minor`,
        ];

  const timeoutProgressLines = timeoutProgress
    ? [
        `- Analyzed progress before timeout: ${timeoutProgress.analyzedFiles}/${timeoutProgress.totalFiles} changed files`,
        `- Findings captured before timeout: ${timeoutProgress.findingCount} total`,
        ...(timeoutBudget
          ? [
              `- Timeout budget: remote runtime ${timeoutBudget.remoteRuntimeBudgetSeconds}s + infra overhead ${timeoutBudget.infraOverheadBudgetSeconds}s = total ${timeoutBudget.totalTimeoutSeconds}s`,
            ]
          : []),
        `- Retry state: ${timeoutProgress.retryState}`,
      ]
    : [];

  const lineCountText = lineCountSource === "github-pr-api-fallback"
    ? `- Lines changed: +${linesAdded} -${linesRemoved} (GitHub PR API fallback; local diff stats unavailable)`
    : `- Lines changed: +${linesAdded} -${linesRemoved}`;

  const reviewPlanDetailsLines: string[] = [];
  try {
    const line = formatReviewPlanReviewDetailsLine(reviewPlanSummary);
    if (line) {
      reviewPlanDetailsLines.push(line);
    }
  } catch {
    // Keep Review Details fail-open; malformed public ReviewPlan projections must not block publication.
  }

  const candidatePublicationBridgeLines: string[] = [];
  try {
    const line = formatCandidatePublicationBridgeLine(candidatePublicationBridge);
    if (line) {
      candidatePublicationBridgeLines.push(line);
    }
  } catch {
    // Keep Review Details fail-open; malformed M072 bridge projections must not block publication.
  }

  const candidateVerificationPublicationEvidenceLines: string[] = [];
  try {
    const line = formatCandidateVerificationPublicationEvidenceLine(candidateVerificationPublicationEvidence);
    if (line) {
      candidateVerificationPublicationEvidenceLines.push(line);
    }
  } catch {
    // Keep Review Details fail-open; malformed diagnostic projections must not block publication.
  }

  const reviewFindingLifecycleLines: string[] = [];
  try {
    const line = formatReviewFindingLifecycleDetailsLine(reviewFindingLifecycle);
    if (line) {
      reviewFindingLifecycleLines.push(line);
    }
  } catch {
    // Keep Review Details fail-open; malformed lifecycle projections must not block publication.
  }

  const reviewValidationTruthLines: string[] = [];
  try {
    const line = formatReviewValidationTruthDetailsLine(reviewValidationTruth);
    if (line) {
      reviewValidationTruthLines.push(line);
    }
  } catch {
    // Keep Review Details fail-open; malformed validation truth projections must not block publication.
  }

  const sections = [
    "<details>",
    "<summary>Review Details</summary>",
    "",
    ...formatReviewPlanDetailsLine(reviewPlan),
    ...formatReviewReducerDetailsLine(reviewReducer),
    ...formatReviewCandidateFindingDetailsLine(reviewCandidateFinding),
    ...formatReviewCandidatePublicationDetailsLine(reviewCandidatePublication),
    ...primaryReviewDetailLines,
    ...timeoutProgressLines,
    lineCountText,
    ...(hasBoundedProfileDetails && reviewBoundedness
      ? [
          formatProfileLine("Requested profile", reviewBoundedness.requestedProfile),
          `- Effective profile: ${reviewBoundedness.effectiveProfile.selectedProfile}`,
          ...(reviewBoundedness.largePR
            ? [
                `- Bounded review: covered ${reviewBoundedness.largePR.reviewedCount}/${reviewBoundedness.largePR.totalFiles} changed files via large-PR triage (${reviewBoundedness.largePR.fullCount} full, ${reviewBoundedness.largePR.abbreviatedCount} abbreviated; ${reviewBoundedness.largePR.notReviewedCount} not reviewed)`,
              ]
            : []),
          ...(reviewBoundedness.timeout?.reductionApplied
            ? ["- Timeout auto-reduction: applied"]
            : reviewBoundedness.timeout?.reductionSkippedReason === "explicit-profile"
              ? ["- Timeout auto-reduction: skipped (explicit profile)"]
              : reviewBoundedness.timeout?.reductionSkippedReason === "config-disabled"
                ? ["- Timeout auto-reduction: skipped (config disabled)"]
                : []),
        ]
      : [profileLine]),
    `- Contributor experience: ${contributorExperience.text}`,
    ...(shadowSpecialistReviewDetails?.reviewDetailsLine
      ? [`- ${shadowSpecialistReviewDetails.reviewDetailsLine}`]
      : []),
    ...reviewPlanDetailsLines,
    ...candidatePublicationBridgeLines,
    ...candidateVerificationPublicationEvidenceLines,
    ...reviewFindingLifecycleLines,
    ...reviewValidationTruthLines,
    `- Review completed: ${params.completedAt ?? new Date().toISOString()}`,
  ];

  if (phaseTimingSummary) {
    try {
      const phaseTimingLines = formatReviewDetailsPhaseTimingSummary(phaseTimingSummary);
      if (phaseTimingLines.length > 0) {
        sections.push("", ...phaseTimingLines);
      }
    } catch {
      // Keep Review Details publication fail-open if timing formatting regresses.
    }
  }

  if (usageLimit?.utilization !== undefined) {
    const pct = Math.round(usageLimit.utilization * 100);
    const pctLeft = 100 - pct;
    const type = usageLimit.rateLimitType ?? 'usage';
    const resetStr = usageLimit.resetsAt !== undefined
      ? ` | resets ${new Date(usageLimit.resetsAt * 1000).toISOString()}`
      : '';
    sections.push(`- Claude Code usage: ${pctLeft}% of ${type} limit remaining${resetStr}`);
  }

  if (tokenUsage?.inputTokens !== undefined || tokenUsage?.outputTokens !== undefined) {
    const inp = tokenUsage?.inputTokens ?? 0;
    const out = tokenUsage?.outputTokens ?? 0;
    const costStr = tokenUsage?.costUsd !== undefined ? ` | ${tokenUsage.costUsd.toFixed(4)}` : '';
    sections.push(`- Tokens: ${inp.toLocaleString()} in / ${out.toLocaleString()} out${costStr}`);
  }

  if (largePRTriage) {
    const reviewedCount = largePRTriage.fullCount + largePRTriage.abbreviatedCount;
    const notReviewedCount = largePRTriage.totalFiles - reviewedCount;

    sections.push(
      "",
      `- Review scope: Reviewed ${reviewedCount}/${largePRTriage.totalFiles} files, prioritized by risk`,
      `- Full review: ${largePRTriage.fullCount} files | Abbreviated review: ${largePRTriage.abbreviatedCount} files | Not reviewed: ${notReviewedCount} files`,
    );

    if (largePRTriage.mentionOnlyFiles.length > 0) {
      const MAX_MENTION_ONLY_ENTRIES = 100;
      const cappedFiles = largePRTriage.mentionOnlyFiles.slice(0, MAX_MENTION_ONLY_ENTRIES);
      const remaining = largePRTriage.mentionOnlyFiles.length - cappedFiles.length;

      sections.push(
        "",
        "<details>",
        "<summary>Files not fully reviewed (sorted by risk score)</summary>",
        "",
      );

      for (const file of cappedFiles) {
        sections.push(`- ${file.filePath} (risk: ${file.score})`);
      }

      if (remaining > 0) {
        sections.push(`- ...and ${remaining} more files`);
      }

      sections.push("", "</details>");
    }
  }

  if (feedbackSuppressionCount && feedbackSuppressionCount > 0) {
    sections.push(`- ${feedbackSuppressionCount} pattern${feedbackSuppressionCount === 1 ? '' : 's'} auto-suppressed by feedback`);
  }

  if (prioritization) {
    const hasSaturatedCommentCap =
      typeof prioritization.maxComments === "number" &&
      typeof prioritization.selectedFindings === "number" &&
      typeof prioritization.omittedFindings === "number" &&
      prioritization.omittedFindings > 0;

    if (hasSaturatedCommentCap) {
      const omittedFindingLabel = prioritization.omittedFindings === 1 ? "finding" : "findings";
      sections.push(
        `- Comment cap saturated: published ${prioritization.selectedFindings}/${prioritization.findingsScored} prioritized findings; ${prioritization.omittedFindings} lower-priority ${omittedFindingLabel} omitted from inline publication`,
      );
    }

    sections.push(
      `- Prioritization: scored ${prioritization.findingsScored} findings | top score ${prioritization.topScore ?? "n/a"} | threshold score ${prioritization.thresholdScore ?? "n/a"}`,
    );
  }

  const structuralImpactSection = buildStructuralImpactSection(structuralImpact);
  if (structuralImpactSection.text) {
    const structuralImpactDegradation = summarizeStructuralImpactDegradation(structuralImpact);
    sections.push(structuralImpactSection.text);
    sections.push(
      `- Structural Impact rendered: callers ${structuralImpactSection.stats.callersRendered}/${structuralImpactSection.stats.callersTotal}${structuralImpactSection.stats.callersTruncated ? " truncated" : ""}; files ${structuralImpactSection.stats.filesRendered}/${structuralImpactSection.stats.filesTotal}${structuralImpactSection.stats.filesTruncated ? " truncated" : ""}; tests ${structuralImpactSection.stats.testsRendered}/${structuralImpactSection.stats.testsTotal}${structuralImpactSection.stats.testsTruncated ? " truncated" : ""}; unchanged evidence ${structuralImpactSection.stats.evidenceRendered}/${structuralImpactSection.stats.evidenceTotal}${structuralImpactSection.stats.evidenceTruncated ? " truncated" : ""}`,
    );
    if (structuralImpactDegradation.fallbackUsed) {
      sections.push(
        `- Structural Impact degradation: status ${structuralImpactDegradation.status}; graph ${structuralImpactDegradation.availability.graphAvailable ? "available" : "unavailable"}; corpus ${structuralImpactDegradation.availability.corpusAvailable ? "available" : "unavailable"}; signals ${structuralImpactDegradation.truthfulnessSignals.join(", ")}`,
      );
    }
  }

  const keywordSection = buildKeywordParsingSection(
    keywordParsing ?? DEFAULT_EMPTY_INTENT,
  );
  sections.push(keywordSection);

  sections.push(
    "",
    "</details>",
    "",
    buildReviewDetailsMarker(reviewOutputKey),
  );

  return sections.join("\n");
}

export function normalizeSeverity(value: string | undefined): FindingSeverity | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "critical" || normalized === "major" || normalized === "medium" || normalized === "minor") {
    return normalized;
  }
  return null;
}

export function normalizeCategory(value: string | undefined): FindingCategory {
  if (!value) return "correctness";
  const normalized = value.trim().toLowerCase();
  if (normalized === "security") return "security";
  if (normalized === "correctness" || normalized === "error-handling") return "correctness";
  if (normalized === "performance" || normalized === "resource-management" || normalized === "concurrency") {
    return "performance";
  }
  if (normalized === "style") return "style";
  if (normalized === "documentation") return "documentation";
  return "correctness";
}

export function parseInlineCommentMetadata(body: string): {
  severity: FindingSeverity | null;
  category: FindingCategory;
  title: string;
} {
  const text = body.replace(/<!--\s*kodiai:review-output-key:[\s\S]*?-->/gi, "").trim();
  const yamlMatch = text.match(/^```yaml\s*([\s\S]*?)```/i);

  if (yamlMatch) {
    const metadataLines = (yamlMatch[1] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(":"));
    const metadata = new Map<string, string>();
    for (const line of metadataLines) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      metadata.set(key, value);
    }

    const titleSection = text.slice(yamlMatch[0].length).trim();
    const titleLine = titleSection
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "Untitled finding";
    const title = titleLine.replace(/^\*\*(.+)\*\*$/, "$1").trim();

    return {
      severity: normalizeSeverity(metadata.get("severity")),
      category: normalizeCategory(metadata.get("category")),
      title,
    };
  }

  const firstLine = text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const severityPrefix = firstLine.match(/^\[(critical|major|medium|minor)\]\s*(.*)$/i);
  if (severityPrefix) {
    return {
      severity: normalizeSeverity(severityPrefix[1]),
      category: "correctness",
      title: (severityPrefix[2] || "Untitled finding").trim(),
    };
  }

  return {
    severity: null,
    category: "correctness",
    title: firstLine || "Untitled finding",
  };
}

/**
 * Normalize a user-authored skip pattern for backward compatibility.
 * - "docs/" -> "docs/**"   (directory shorthand)
 * - "*.md"  -> "**\/*.md"  (extension-only matches nested files)
 */
export function normalizeSkipPattern(pattern: string): string {
  const p = pattern.trim();
  if (p.endsWith("/")) return `${p}**`;
  if (p.startsWith("*.")) return `**/${p}`;
  return p;
}

export function renderApprovalConfidence(mc: MergeConfidence): string {
  const emoji = mc.level === "high" ? ":green_circle:" : mc.level === "medium" ? ":yellow_circle:" : ":red_circle:";
  const label = mc.level === "high" ? "High" : mc.level === "medium" ? "Review Recommended" : "Careful Review Required";
  return `${emoji} **Merge Confidence: ${label}** — ${mc.rationale[0] ?? ""}`;
}

export function splitGitLines(output: string): string[] {
  return output.trim().split("\n").filter(Boolean);
}

export function isReviewTriggerEnabled(
  action: string,
  triggers: {
    onOpened: boolean;
    onReadyForReview: boolean;
    onReviewRequested: boolean;
    onSynchronize?: boolean;
  },
): boolean {
  if (action === "opened") return triggers.onOpened;
  if (action === "ready_for_review") return triggers.onReadyForReview;
  if (action === "review_requested") return triggers.onReviewRequested;
  if (action === "synchronize") return triggers.onSynchronize ?? false;
  return false;
}

export function normalizeReviewerLogin(login: string): string {
  return login.trim().toLowerCase().replace(/\[bot\]$/i, "");
}

/**
 * Split a full unified diff (multi-file) into per-file segments.
 * Returns an array of `{ filename, patch }` objects for each file in the diff.
 */
export function splitDiffByFile(diffContent: string): Array<{ filename: string; patch: string }> {
  const DIFF_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
  const lines = diffContent.split("\n");
  const files: Array<{ filename: string; patch: string }> = [];
  let currentFilename: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headerMatch = DIFF_HEADER_RE.exec(line);
    if (headerMatch) {
      if (currentFilename !== null && currentLines.length > 0) {
        files.push({ filename: currentFilename, patch: currentLines.join("\n") });
      }
      currentFilename = headerMatch[2]!;
      currentLines = [];
    } else if (currentFilename !== null) {
      currentLines.push(line);
    }
  }
  if (currentFilename !== null && currentLines.length > 0) {
    files.push({ filename: currentFilename, patch: currentLines.join("\n") });
  }

  return files;
}
