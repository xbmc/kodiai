import type { ReviewFindingLifecyclePublicProjection } from "../review-lifecycle/finding-lifecycle.ts";
import type { ValidationTruthProjection } from "../review-lifecycle/validation-truth.ts";
import {
  boundedBridgeToken,
  boundedReviewDetailsValue,
  formatCountFields,
  formatStringArray,
  readNonNegativeCount,
} from "./review-details-shared-formatting.ts";

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

export function formatReviewValidationTruthDetailsLine(
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

export function formatReviewFindingLifecycleDetailsLine(
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
