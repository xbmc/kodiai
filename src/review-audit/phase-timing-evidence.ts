import type { ReviewPhaseName, ReviewPhaseStatus, ReviewPhaseTiming } from "../execution/types.ts";
import type { NormalizedLogAnalyticsRow } from "./log-analytics.ts";

export const REVIEW_PHASE_TIMING_LOG_MESSAGE = "Review phase timing summary";
export const REQUIRED_REVIEW_PHASES = [
  "queue wait",
  "workspace preparation",
  "retrieval/context assembly",
  "executor handoff",
  "remote runtime",
  "publication",
] as const satisfies ReadonlyArray<ReviewPhaseName>;

export type EvidenceAvailability = "present" | "missing" | "unavailable";
export type PhaseTimingEvidenceStatus =
  | "ok"
  | "no-matching-logs"
  | "correlation-mismatch"
  | "invalid-phase-payload";

export type PhaseTimingEvidence = {
  reviewOutputKey: string;
  deliveryId: string | null;
  conclusion: string | null;
  published: boolean | null;
  totalDurationMs: number | null;
  timeGenerated: string | null;
  revisionName: string | null;
  containerAppName: string | null;
  phases: ReviewPhaseTiming[];
};

export type PhaseTimingEvidenceResult = {
  status: PhaseTimingEvidenceStatus;
  sourceAvailability: {
    azureLogs: EvidenceAvailability;
  };
  correlation: {
    requestedReviewOutputKey: string;
    requestedDeliveryId: string | null;
    matchedReviewOutputKey: string | null;
    matchedDeliveryId: string | null;
    matchedRowCount: number;
    duplicateRowCount: number;
    driftedRowCount: number;
  };
  evidence: PhaseTimingEvidence | null;
  issues: string[];
};

function normalizeIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isFiniteNonNegativeDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isReviewPhaseName(value: unknown): value is ReviewPhaseName {
  return typeof value === "string"
    && (REQUIRED_REVIEW_PHASES as ReadonlyArray<string>).includes(value);
}

function isReviewPhaseStatus(value: unknown): value is ReviewPhaseStatus {
  return value === "completed" || value === "degraded" || value === "unavailable";
}

function buildUnavailablePhase(name: ReviewPhaseName, detail: string): ReviewPhaseTiming {
  return {
    name,
    status: "unavailable",
    detail,
  };
}

function getParsedField(row: NormalizedLogAnalyticsRow, field: "reviewOutputKey" | "deliveryId"): string | null {
  const parsedValue = row.parsedLog?.[field];
  if (typeof parsedValue === "string" && parsedValue.trim().length > 0) {
    return parsedValue;
  }

  return field === "reviewOutputKey" ? row.reviewOutputKey : row.deliveryId;
}

function isPhaseTimingSummaryRow(row: NormalizedLogAnalyticsRow): boolean {
  if (row.message === REVIEW_PHASE_TIMING_LOG_MESSAGE) {
    return true;
  }

  const parsedMessage = row.parsedLog?.msg;
  if (parsedMessage === REVIEW_PHASE_TIMING_LOG_MESSAGE) {
    return true;
  }

  return typeof row.rawLog === "string" && row.rawLog.includes(REVIEW_PHASE_TIMING_LOG_MESSAGE);
}

function buildRowFingerprint(row: NormalizedLogAnalyticsRow): string {
  const payload = row.rawLog ?? JSON.stringify(row.parsedLog ?? {});
  return `${row.timeGenerated ?? ""}|${payload}`;
}

function compareRowsByRecency(a: NormalizedLogAnalyticsRow, b: NormalizedLogAnalyticsRow): number {
  const aTime = a.timeGenerated ? Date.parse(a.timeGenerated) : Number.NEGATIVE_INFINITY;
  const bTime = b.timeGenerated ? Date.parse(b.timeGenerated) : Number.NEGATIVE_INFINITY;
  return aTime - bTime;
}

function normalizePhases(rawPhases: unknown): { phases: ReviewPhaseTiming[]; issues: string[] } {
  const issues: string[] = [];
  const phaseMap = new Map<ReviewPhaseName, ReviewPhaseTiming>();
  const unknownNames = new Set<string>();

  if (!Array.isArray(rawPhases)) {
    issues.push("Missing phases array on Review phase timing summary payload.");
  } else {
    for (const rawPhase of rawPhases) {
      if (typeof rawPhase !== "object" || rawPhase === null) {
        issues.push("Encountered malformed phase timing entry.");
        continue;
      }

      const candidate = rawPhase as {
        name?: unknown;
        status?: unknown;
        durationMs?: unknown;
        detail?: unknown;
      };

      if (!isReviewPhaseName(candidate.name)) {
        if (typeof candidate.name === "string" && candidate.name.trim().length > 0) {
          unknownNames.add(candidate.name.trim());
        } else {
          issues.push("Encountered malformed phase timing entry.");
        }
        continue;
      }

      const detail = typeof candidate.detail === "string" && candidate.detail.trim().length > 0
        ? candidate.detail.trim()
        : undefined;

      if (!isReviewPhaseStatus(candidate.status)) {
        issues.push(`Invalid phase timing status for ${candidate.name}.`);
        phaseMap.set(candidate.name, buildUnavailablePhase(candidate.name, "invalid phase timing data"));
        continue;
      }

      if (candidate.status === "unavailable") {
        phaseMap.set(candidate.name, {
          name: candidate.name,
          status: "unavailable",
          ...(detail ? { detail } : {}),
        });
        continue;
      }

      if (!isFiniteNonNegativeDuration(candidate.durationMs)) {
        issues.push(`Invalid phase timing duration for ${candidate.name}.`);
        phaseMap.set(candidate.name, buildUnavailablePhase(candidate.name, "invalid phase timing data"));
        continue;
      }

      phaseMap.set(candidate.name, {
        name: candidate.name,
        status: candidate.status,
        durationMs: candidate.durationMs,
        ...(detail ? { detail } : {}),
      });
    }
  }

  if (unknownNames.size > 0) {
    issues.push(`Unknown review phase names: ${[...unknownNames].sort().join(", ")}.`);
  }

  const missingPhases = REQUIRED_REVIEW_PHASES.filter((name) => !phaseMap.has(name));
  if (missingPhases.length > 0) {
    issues.push(`Missing required phases: ${missingPhases.join(", ")}.`);
  }

  return {
    phases: REQUIRED_REVIEW_PHASES.map((name) => phaseMap.get(name) ?? buildUnavailablePhase(name, "phase timing unavailable")),
    issues,
  };
}

export function buildPhaseTimingEvidence(params: {
  reviewOutputKey: string;
  deliveryId?: string | null;
  rows: NormalizedLogAnalyticsRow[];
}): PhaseTimingEvidenceResult {
  const requestedReviewOutputKey = normalizeIdentifier(params.reviewOutputKey) ?? params.reviewOutputKey;
  const requestedDeliveryId = normalizeIdentifier(params.deliveryId);
  const candidateRows = params.rows.filter(isPhaseTimingSummaryRow);
  const matchedRows: NormalizedLogAnalyticsRow[] = [];
  let driftedRowCount = 0;

  for (const row of candidateRows) {
    const rowReviewOutputKey = normalizeIdentifier(getParsedField(row, "reviewOutputKey"));
    const rowDeliveryId = normalizeIdentifier(getParsedField(row, "deliveryId"));

    const reviewOutputMatches = rowReviewOutputKey === requestedReviewOutputKey;
    const deliveryMatches = requestedDeliveryId === null || rowDeliveryId === requestedDeliveryId;

    if (reviewOutputMatches && deliveryMatches) {
      matchedRows.push(row);
      continue;
    }

    driftedRowCount += 1;
  }

  const dedupedRows: NormalizedLogAnalyticsRow[] = [];
  const seenFingerprints = new Set<string>();
  for (const row of matchedRows) {
    const fingerprint = buildRowFingerprint(row);
    if (seenFingerprints.has(fingerprint)) {
      continue;
    }
    seenFingerprints.add(fingerprint);
    dedupedRows.push(row);
  }

  const duplicateRowCount = matchedRows.length - dedupedRows.length;
  const baseResult = {
    sourceAvailability: {
      azureLogs: params.rows.length > 0 ? "present" : "missing",
    } satisfies PhaseTimingEvidenceResult["sourceAvailability"],
    correlation: {
      requestedReviewOutputKey,
      requestedDeliveryId,
      matchedReviewOutputKey: null,
      matchedDeliveryId: null,
      matchedRowCount: matchedRows.length,
      duplicateRowCount,
      driftedRowCount,
    } satisfies PhaseTimingEvidenceResult["correlation"],
  };

  if (dedupedRows.length === 0) {
    return {
      status: driftedRowCount > 0 ? "correlation-mismatch" : "no-matching-logs",
      ...baseResult,
      evidence: null,
      issues: driftedRowCount > 0
        ? ["No phase timing log rows matched the requested reviewOutputKey + deliveryId correlation."]
        : ["No Review phase timing summary rows found for the requested review output key."],
    };
  }

  const selectedRow = [...dedupedRows].sort(compareRowsByRecency).at(-1)!;
  const parsedLog = selectedRow.parsedLog;
  const issues: string[] = [];

  if (!parsedLog) {
    issues.push("Malformed Review phase timing summary payload.");
  }

  const totalDurationMs = parsedLog && isFiniteNonNegativeDuration(parsedLog.totalDurationMs)
    ? parsedLog.totalDurationMs
    : null;
  if (totalDurationMs === null) {
    issues.push("Missing totalDurationMs on Review phase timing summary payload.");
  }

  const phaseNormalization = normalizePhases(parsedLog?.phases);
  issues.push(...phaseNormalization.issues);

  const matchedReviewOutputKey = normalizeIdentifier(getParsedField(selectedRow, "reviewOutputKey"))
    ?? requestedReviewOutputKey;
  const matchedDeliveryId = normalizeIdentifier(getParsedField(selectedRow, "deliveryId"))
    ?? requestedDeliveryId;

  return {
    status: issues.length > 0 ? "invalid-phase-payload" : "ok",
    ...baseResult,
    correlation: {
      ...baseResult.correlation,
      matchedReviewOutputKey,
      matchedDeliveryId,
    },
    evidence: {
      reviewOutputKey: matchedReviewOutputKey,
      deliveryId: matchedDeliveryId,
      conclusion: typeof parsedLog?.conclusion === "string" ? parsedLog.conclusion : null,
      published: typeof parsedLog?.published === "boolean" ? parsedLog.published : null,
      totalDurationMs,
      timeGenerated: selectedRow.timeGenerated,
      revisionName: selectedRow.revisionName,
      containerAppName: selectedRow.containerAppName,
      phases: phaseNormalization.phases,
    },
    issues,
  };
}
