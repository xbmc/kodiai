import type {
  ShadowSpecialistMetricAvailabilityProjection,
  ShadowSpecialistMetricsProjection,
} from "./shadow-specialist-metrics.ts";
import type {
  ShadowSpecialistDecision,
  ShadowSpecialistDecisionCounts,
  ShadowSpecialistOutputStatus,
} from "./shadow-specialist.ts";

export type ShadowSpecialistReviewDetailsMetricAvailability = ShadowSpecialistMetricAvailabilityProjection;

export type ShadowSpecialistReviewDetailsProjection = {
  readonly laneId: string | null;
  readonly status: ShadowSpecialistOutputStatus;
  readonly outputStatus: ShadowSpecialistOutputStatus;
  readonly reason: string | null;
  readonly candidateCount: number;
  readonly decisionCount: number;
  readonly decisionCounts: ShadowSpecialistDecisionCounts;
  readonly duplicateCount: number;
  readonly disagreementCount: number;
  readonly dismissedCount: number;
  readonly unclassifiableCount: number;
  readonly truncatedCandidateCount: number;
  readonly metricAvailability: ShadowSpecialistReviewDetailsMetricAvailability;
  readonly tokenCountAvailable: boolean;
  readonly costAvailable: boolean;
  readonly latencyMsAvailable: boolean;
  readonly deliveryId: string | null;
  readonly reviewOutputKey: string | null;
  readonly correlationKey: string | null;
  readonly redactionFlags: {
    readonly unsafeFieldCount: number;
    readonly discardedRawPayload: boolean;
    readonly discardedPublicationFields: boolean;
    readonly discardedApprovalFields: boolean;
  };
  readonly privateOnly: true;
  readonly shadowOnly: true;
  readonly publishesFindings: false;
  readonly visiblePublicationDenied: true;
  readonly approvalPublicationDenied: true;
  readonly rawContentFieldCount: 0;
  readonly candidateBodyFieldCount: 0;
  readonly githubPublicationFieldCount: 0;
  readonly approvalFieldCount: 0;
  readonly specialistContentIncluded: false;
  readonly candidateFingerprintsIncluded: false;
  readonly candidateBodiesIncluded: false;
  readonly rawModelOutputIncluded: false;
  readonly toolPayloadIncluded: false;
  readonly approvalFieldsIncluded: false;
  readonly tierModeIncluded: false;
  readonly reviewDetailsLine: string;
};

const OUTPUT_STATUSES = new Set<ShadowSpecialistOutputStatus>([
  "ok",
  "skipped",
  "degraded",
  "error",
  "unclassifiable",
]);

const DECISIONS: readonly ShadowSpecialistDecision[] = [
  "candidate",
  "duplicate",
  "disagreement",
  "dismissed",
  "unclassifiable",
];

const LINE_MAX_LENGTH = 640;
const FIELD_MAX_LENGTH = 128;
const REASON_MAX_LENGTH = 96;

const EMPTY_DECISION_COUNTS: ShadowSpecialistDecisionCounts = {
  candidate: 0,
  duplicate: 0,
  disagreement: 0,
  dismissed: 0,
  unclassifiable: 0,
};

const UNAVAILABLE_METRICS: ShadowSpecialistReviewDetailsMetricAvailability = {
  tokenCount: "unavailable",
  costUsd: "unavailable",
  latencyMs: "unavailable",
};

/**
 * Builds the public Review Details/verifier projection from S03 aggregate metrics only.
 *
 * This boundary intentionally accepts no raw candidates, prompts, model output, tool payloads,
 * publication bodies, approval decisions, or fingerprints. Malformed aggregate fields degrade to
 * bounded unavailable values so later Review Details/log/verifier callers can fail open safely.
 */
export function buildShadowSpecialistReviewDetailsProjection(
  metrics: Partial<ShadowSpecialistMetricsProjection> | null | undefined,
): ShadowSpecialistReviewDetailsProjection {
  const record = isRecord(metrics) ? metrics : {};
  const malformedInput = !isRecord(metrics);
  const status = normalizeStatus(record.status, malformedInput);
  const decisionCounts = normalizeDecisionCounts(record.decisionCounts);
  const metricAvailability = normalizeMetricAvailability(record.metricAvailability);
  const redactionFlags = normalizeRedactionFlags(record.redactionFlags);

  const projectionWithoutLine = {
    laneId: normalizeLaneId(record.laneId),
    status,
    outputStatus: status,
    reason: normalizeReason(record.reason, malformedInput),
    candidateCount: normalizeCount(record.candidateCount),
    decisionCount: normalizeCount(record.decisionCount),
    decisionCounts,
    duplicateCount: normalizeCount(record.duplicateCount),
    disagreementCount: normalizeCount(record.disagreementCount),
    dismissedCount: normalizeCount(record.dismissedCount),
    unclassifiableCount: normalizeCount(record.unclassifiableCount),
    truncatedCandidateCount: normalizeCount(record.truncatedCandidateCount),
    metricAvailability,
    tokenCountAvailable: metricAvailability.tokenCount === "available",
    costAvailable: metricAvailability.costUsd === "available",
    latencyMsAvailable: metricAvailability.latencyMs === "available",
    deliveryId: normalizeBoundedField(record.deliveryId),
    reviewOutputKey: normalizeBoundedField(record.reviewOutputKey),
    correlationKey: normalizeBoundedField(record.correlationKey),
    redactionFlags,
    privateOnly: true,
    shadowOnly: true,
    publishesFindings: false,
    visiblePublicationDenied: true,
    approvalPublicationDenied: true,
    rawContentFieldCount: 0,
    candidateBodyFieldCount: 0,
    githubPublicationFieldCount: 0,
    approvalFieldCount: 0,
    specialistContentIncluded: false,
    candidateFingerprintsIncluded: false,
    candidateBodiesIncluded: false,
    rawModelOutputIncluded: false,
    toolPayloadIncluded: false,
    approvalFieldsIncluded: false,
    tierModeIncluded: false,
  } satisfies Omit<ShadowSpecialistReviewDetailsProjection, "reviewDetailsLine">;

  const reviewDetailsLine = formatShadowSpecialistReviewDetailsLine(projectionWithoutLine);
  return { ...projectionWithoutLine, reviewDetailsLine };
}

export function formatShadowSpecialistReviewDetailsLine(
  projection: Omit<ShadowSpecialistReviewDetailsProjection, "reviewDetailsLine"> | ShadowSpecialistReviewDetailsProjection,
): string {
  const reason = projection.reason ?? "none";
  const reviewOutputKey = projection.reviewOutputKey ?? "none";
  const deliveryId = projection.deliveryId ?? "none";
  const correlationKey = projection.correlationKey ?? "none";
  const laneId = projection.laneId ?? "none";
  const parts = [
    `Shadow specialist: lane=${laneId}`,
    `status=${projection.status}`,
    `reason=${reason}`,
    `candidateCount=${projection.candidateCount}`,
    `decisionCount=${projection.decisionCount}`,
    `decisionCounts=${formatDecisionCounts(projection.decisionCounts)}`,
    `duplicateCount=${projection.duplicateCount}`,
    `disagreementCount=${projection.disagreementCount}`,
    `dismissedCount=${projection.dismissedCount}`,
    `unclassifiableCount=${projection.unclassifiableCount}`,
    `truncatedCandidateCount=${projection.truncatedCandidateCount}`,
    `metricAvailability=token:${yesNo(projection.tokenCountAvailable)},cost:${yesNo(projection.costAvailable)},latency:${yesNo(projection.latencyMsAvailable)}`,
    `visiblePublicationDenied=${projection.visiblePublicationDenied}`,
    `approvalPublicationDenied=${projection.approvalPublicationDenied}`,
    `privateOnly=${projection.privateOnly}`,
    `shadowOnly=${projection.shadowOnly}`,
    `correlationKey=${correlationKey}`,
    `deliveryId=${deliveryId}`,
    `reviewOutputKey=${reviewOutputKey}`,
    `redacted=raw:${yesNo(projection.redactionFlags.discardedRawPayload)},publication:${yesNo(projection.redactionFlags.discardedPublicationFields)},approval:${yesNo(projection.redactionFlags.discardedApprovalFields)},unsafe:${projection.redactionFlags.unsafeFieldCount}`,
  ];

  return capLine(parts.join(" "));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStatus(value: unknown, malformedInput: boolean): ShadowSpecialistOutputStatus {
  if (typeof value === "string") {
    const normalized = sanitizeText(value, FIELD_MAX_LENGTH).toLowerCase();
    if (OUTPUT_STATUSES.has(normalized as ShadowSpecialistOutputStatus)) {
      return normalized as ShadowSpecialistOutputStatus;
    }
  }

  return malformedInput ? "degraded" : "unclassifiable";
}

function normalizeLaneId(value: unknown): string | null {
  return value === "docs-config-truth" ? value : null;
}

function normalizeReason(value: unknown, malformedInput: boolean): string | null {
  const normalized = normalizeBoundedField(value, REASON_MAX_LENGTH);
  if (normalized !== null) {
    return normalized;
  }

  return malformedInput ? "malformed-shadow-specialist-metrics" : null;
}

function normalizeBoundedField(value: unknown, maxLength = FIELD_MAX_LENGTH): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = sanitizeText(value, maxLength);
  return normalized.length > 0 ? normalized : null;
}

function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value)
    ? value
    : 0;
}

function normalizeDecisionCounts(value: unknown): ShadowSpecialistDecisionCounts {
  if (!isRecord(value)) {
    return { ...EMPTY_DECISION_COUNTS };
  }

  const counts = { ...EMPTY_DECISION_COUNTS };
  for (const decision of DECISIONS) {
    counts[decision] = normalizeCount(value[decision]);
  }
  return counts;
}

function normalizeMetricAvailability(value: unknown): ShadowSpecialistReviewDetailsMetricAvailability {
  if (!isRecord(value)) {
    return { ...UNAVAILABLE_METRICS };
  }

  return {
    tokenCount: value.tokenCount === "available" ? "available" : "unavailable",
    costUsd: value.costUsd === "available" ? "available" : "unavailable",
    latencyMs: value.latencyMs === "available" ? "available" : "unavailable",
  };
}

function normalizeRedactionFlags(value: unknown): ShadowSpecialistReviewDetailsProjection["redactionFlags"] {
  if (!isRecord(value)) {
    return {
      unsafeFieldCount: 0,
      discardedRawPayload: false,
      discardedPublicationFields: false,
      discardedApprovalFields: false,
    };
  }

  return {
    unsafeFieldCount: normalizeCount(value.unsafeFieldCount),
    discardedRawPayload: value.discardedRawPayload === true,
    discardedPublicationFields: value.discardedPublicationFields === true,
    discardedApprovalFields: value.discardedApprovalFields === true,
  };
}

function formatDecisionCounts(counts: ShadowSpecialistDecisionCounts): string {
  return DECISIONS.map((decision) => `${decision}:${counts[decision]}`).join(",");
}

function yesNo(value: boolean): "y" | "n" {
  return value ? "y" : "n";
}

function capLine(value: string): string {
  const sanitized = sanitizeText(value, LINE_MAX_LENGTH + 1);
  return sanitized.length > LINE_MAX_LENGTH
    ? `${sanitized.slice(0, LINE_MAX_LENGTH - 1)}…`
    : sanitized;
}
