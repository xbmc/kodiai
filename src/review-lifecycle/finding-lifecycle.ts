import { createHash } from "node:crypto";
import type { FindingCategory, FindingSeverity } from "../lib/review-utils.ts";

export type ReviewFindingLifecycleStatus =
  | "detected"
  | "open"
  | "suggested"
  | "validated"
  | "revalidated"
  | "resolved"
  | "blocked"
  | "degraded";

export type ReviewFindingLifecycleRejectionReason =
  | "missing-correlation"
  | "missing-file-path"
  | "unsafe-file-path"
  | "missing-title"
  | "invalid-line-range"
  | "field-too-long"
  | "unsafe-text";

export type ReviewFindingActionability =
  | "actionable"
  | "needs-human-review"
  | "needs-reproduction"
  | "blocked"
  | "not-actionable";

export type ReviewFindingValidationNeed =
  | "none"
  | "needs-tests"
  | "needs-reproduction"
  | "needs-security-review"
  | "needs-owner-confirmation";

export type ReviewFindingRevalidationState =
  | "not-required"
  | "pending"
  | "passed"
  | "failed"
  | "blocked";

export type ReviewFindingEvidenceReference = {
  kind: "file" | "test" | "log" | "rule" | "artifact";
  ref: string;
};

export type ReviewFindingStatusHistoryEntry = {
  status: ReviewFindingLifecycleStatus;
  reasonCode: string;
  evidenceRefs: ReviewFindingEvidenceReference[];
};

export type ReviewFindingLifecycleInput = {
  repo?: string | null;
  pullNumber?: number | null;
  reviewOutputKey?: string | null;
  deliveryId?: string | null;
  commitSha?: string | null;
  headRef?: string | null;
  baseRef?: string | null;
  findings?: ReadonlyArray<ReviewFindingInput> | null;
};

export type ReviewFindingInput = {
  filePath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  severity?: string | null;
  category?: string | null;
  title?: string | null;
  confidence?: number | null;
  actionability?: string | null;
  validationNeeds?: ReadonlyArray<string | null | undefined> | null;
  revalidationState?: string | null;
  statusHistory?: ReadonlyArray<Partial<ReviewFindingStatusHistoryEntry> | null> | null;
  evidenceRefs?: ReadonlyArray<Partial<ReviewFindingEvidenceReference> | null> | null;
  reasonCodes?: ReadonlyArray<string | null | undefined> | null;
  body?: string | null;
  rawPrompt?: string | null;
  rawModelOutput?: string | null;
  candidateBody?: string | null;
  toolPayload?: unknown;
  diffText?: string | null;
};

export type ReviewFindingLifecycleRecord = {
  id: string;
  identityHash: string;
  repo: string;
  pullNumber: number;
  reviewOutputKey: string;
  deliveryId?: string;
  commitIdentity: {
    commitSha?: string;
    headRef?: string;
    baseRef?: string;
  };
  filePath: string;
  startLine?: number;
  endLine?: number;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  confidence: number;
  actionability: ReviewFindingActionability;
  validationNeeds: ReviewFindingValidationNeed[];
  revalidationState: ReviewFindingRevalidationState;
  statusHistory: ReviewFindingStatusHistoryEntry[];
  evidenceRefs: ReviewFindingEvidenceReference[];
  reasonCodes: string[];
};

export type ReviewFindingLifecycleResult = {
  status: "normalized" | "unavailable" | "degraded";
  repo: string;
  pullNumber: number;
  reviewOutputKey: string;
  deliveryId?: string;
  records: ReviewFindingLifecycleRecord[];
  rejections: Array<{ index: number; reason: ReviewFindingLifecycleRejectionReason }>;
  counts: {
    input: number;
    recorded: number;
    rejected: number;
    unsafeInputFields: number;
  };
  reason?: ReviewFindingLifecycleRejectionReason;
};

export type ReviewFindingLifecyclePublicProjection = {
  schema: "review-finding-lifecycle.v1";
  status: ReviewFindingLifecycleResult["status"];
  counts: ReviewFindingLifecycleResult["counts"] & {
    status: Record<ReviewFindingLifecycleStatus, number>;
    severity: Record<FindingSeverity, number>;
    category: Record<FindingCategory, number>;
    actionability: Record<ReviewFindingActionability, number>;
    validationNeeds: Record<ReviewFindingValidationNeed, number>;
    revalidationState: Record<ReviewFindingRevalidationState, number>;
  };
  correlation: {
    repoPresent: boolean;
    pullNumberPresent: boolean;
    reviewOutputKeyPresent: boolean;
    deliveryIdPresent: boolean;
    commitIdentityPresent: boolean;
  };
  reasonCodes: string[];
  rejectedReasonCodes: string[];
  references: Array<{
    id: string;
    status: ReviewFindingLifecycleStatus;
    severity: FindingSeverity;
    category: FindingCategory;
    actionability: ReviewFindingActionability;
    validationNeeds: ReviewFindingValidationNeed[];
    revalidationState: ReviewFindingRevalidationState;
    reasonCodes: string[];
    evidenceRefs: ReviewFindingEvidenceReference[];
  }>;
  omitted: {
    references: number;
    reasonCodes: number;
    rejectedReasonCodes: number;
  };
  redaction: {
    privateOnly: true;
    rawPromptsIncluded: false;
    rawModelOutputIncluded: false;
    candidateBodiesIncluded: false;
    toolPayloadsIncluded: false;
    secretLikeStringsIncluded: false;
    diffsIncluded: false;
    unboundedArraysIncluded: false;
    unsafeInputFieldCount: number;
  };
};

const MAX_TITLE_LENGTH = 160;
const MAX_FILE_PATH_LENGTH = 512;
const MAX_REASON_CODE_LENGTH = 64;
const MAX_REASON_CODES = 8;
const MAX_PUBLIC_REFERENCES = 5;
const MAX_PUBLIC_REFERENCE_REASON_CODES = 4;
const MAX_EVIDENCE_REFS = 4;
const MAX_EVIDENCE_REF_LENGTH = 120;
const MAX_VALIDATION_NEEDS = 4;
const MAX_STATUS_HISTORY = 8;

const STATUS_VALUES: readonly ReviewFindingLifecycleStatus[] = [
  "detected",
  "open",
  "suggested",
  "validated",
  "revalidated",
  "resolved",
  "blocked",
  "degraded",
];

const SEVERITY_VALUES: readonly FindingSeverity[] = ["critical", "major", "medium", "minor"];
const CATEGORY_VALUES: readonly FindingCategory[] = ["security", "correctness", "performance", "style", "documentation"];
const ACTIONABILITY_VALUES: readonly ReviewFindingActionability[] = [
  "actionable",
  "needs-human-review",
  "needs-reproduction",
  "blocked",
  "not-actionable",
];
const VALIDATION_NEED_VALUES: readonly ReviewFindingValidationNeed[] = [
  "none",
  "needs-tests",
  "needs-reproduction",
  "needs-security-review",
  "needs-owner-confirmation",
];
const REVALIDATION_STATE_VALUES: readonly ReviewFindingRevalidationState[] = [
  "not-required",
  "pending",
  "passed",
  "failed",
  "blocked",
];

export function normalizeFindingLifecycle(input: ReviewFindingLifecycleInput): ReviewFindingLifecycleResult {
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const repo = normalizeRequiredString(input.repo);
  const pullNumber = normalizePullNumber(input.pullNumber);
  const reviewOutputKey = normalizeRequiredString(input.reviewOutputKey);
  const deliveryId = normalizeOptionalToken(input.deliveryId);
  const commitIdentity = normalizeCommitIdentity(input);

  if (!repo || pullNumber <= 0 || !reviewOutputKey || !hasCommitIdentity(commitIdentity)) {
    return {
      status: "unavailable",
      repo,
      pullNumber,
      reviewOutputKey,
      ...(deliveryId ? { deliveryId } : {}),
      records: [],
      rejections: findings.map((_, index) => ({ index, reason: "missing-correlation" as const })),
      counts: {
        input: findings.length,
        recorded: 0,
        rejected: findings.length,
        unsafeInputFields: countUnsafeInputFields(findings),
      },
      reason: "missing-correlation",
    };
  }

  const identityCounts = new Map<string, number>();
  const records: ReviewFindingLifecycleRecord[] = [];
  const rejections: ReviewFindingLifecycleResult["rejections"] = [];
  let unsafeInputFields = 0;

  findings.forEach((finding, index) => {
    unsafeInputFields += countUnsafeFindingFields(finding);
    const normalized = normalizeFinding({
      finding,
      repo,
      pullNumber,
      reviewOutputKey,
      deliveryId,
      commitIdentity,
    });

    if ("reason" in normalized) {
      rejections.push({ index, reason: normalized.reason });
      return;
    }

    const duplicateOrdinal = (identityCounts.get(normalized.record.identityHash) ?? 0) + 1;
    identityCounts.set(normalized.record.identityHash, duplicateOrdinal);
    records.push({
      ...normalized.record,
      id: duplicateOrdinal === 1 ? normalized.record.id : `${normalized.record.id}-${duplicateOrdinal}`,
    });
  });

  return {
    status: rejections.length > 0 ? "degraded" : "normalized",
    repo,
    pullNumber,
    reviewOutputKey,
    ...(deliveryId ? { deliveryId } : {}),
    records,
    rejections,
    counts: {
      input: findings.length,
      recorded: records.length,
      rejected: rejections.length,
      unsafeInputFields,
    },
    ...(rejections.length > 0 ? { reason: rejections[0]?.reason ?? "field-too-long" } : {}),
  };
}

export function toFindingLifecyclePublicProjection(
  result: ReviewFindingLifecycleResult,
): ReviewFindingLifecyclePublicProjection {
  const reasonCounts = new Map<string, number>();
  const rejectedReasonCounts = new Map<string, number>();

  const counts = {
    ...result.counts,
    status: createZeroCountRecord(STATUS_VALUES),
    severity: createZeroCountRecord(SEVERITY_VALUES),
    category: createZeroCountRecord(CATEGORY_VALUES),
    actionability: createZeroCountRecord(ACTIONABILITY_VALUES),
    validationNeeds: createZeroCountRecord(VALIDATION_NEED_VALUES),
    revalidationState: createZeroCountRecord(REVALIDATION_STATE_VALUES),
  };

  for (const rejection of result.rejections) {
    incrementMap(rejectedReasonCounts, rejection.reason);
  }

  for (const record of result.records) {
    counts.severity[record.severity] += 1;
    counts.category[record.category] += 1;
    counts.actionability[record.actionability] += 1;
    counts.revalidationState[record.revalidationState] += 1;
    for (const need of record.validationNeeds) {
      counts.validationNeeds[need] += 1;
    }
    for (const status of new Set(record.statusHistory.map((entry) => entry.status))) {
      counts.status[status] += 1;
    }
    for (const reasonCode of record.reasonCodes) {
      incrementMap(reasonCounts, reasonCode);
    }
    for (const statusEntry of record.statusHistory) {
      incrementMap(reasonCounts, statusEntry.reasonCode);
    }
  }

  const reasonEntries = sortedReasonEntries(reasonCounts);
  const rejectedReasonEntries = sortedReasonEntries(rejectedReasonCounts);
  const references = result.records.slice(0, MAX_PUBLIC_REFERENCES).map((record) => ({
    id: record.id,
    status: record.statusHistory.at(-1)?.status ?? "detected",
    severity: record.severity,
    category: record.category,
    actionability: record.actionability,
    validationNeeds: record.validationNeeds.slice(0, MAX_VALIDATION_NEEDS),
    revalidationState: record.revalidationState,
    reasonCodes: record.reasonCodes.slice(0, MAX_PUBLIC_REFERENCE_REASON_CODES),
    evidenceRefs: record.evidenceRefs.slice(0, MAX_EVIDENCE_REFS),
  }));

  return {
    schema: "review-finding-lifecycle.v1",
    status: result.status,
    counts,
    correlation: {
      repoPresent: result.repo.length > 0,
      pullNumberPresent: result.pullNumber > 0,
      reviewOutputKeyPresent: result.reviewOutputKey.length > 0,
      deliveryIdPresent: Boolean(result.deliveryId),
      commitIdentityPresent: result.records.some((record) => hasCommitIdentity(record.commitIdentity)),
    },
    reasonCodes: reasonEntries.slice(0, MAX_REASON_CODES).map(([reason]) => reason),
    rejectedReasonCodes: rejectedReasonEntries.slice(0, MAX_REASON_CODES).map(([reason]) => reason),
    references,
    omitted: {
      references: Math.max(0, result.records.length - references.length),
      reasonCodes: Math.max(0, reasonEntries.length - MAX_REASON_CODES),
      rejectedReasonCodes: Math.max(0, rejectedReasonEntries.length - MAX_REASON_CODES),
    },
    redaction: {
      privateOnly: true,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      candidateBodiesIncluded: false,
      toolPayloadsIncluded: false,
      secretLikeStringsIncluded: false,
      diffsIncluded: false,
      unboundedArraysIncluded: false,
      unsafeInputFieldCount: result.counts.unsafeInputFields,
    },
  };
}

function normalizeFinding(input: {
  finding: ReviewFindingInput;
  repo: string;
  pullNumber: number;
  reviewOutputKey: string;
  deliveryId?: string;
  commitIdentity: ReviewFindingLifecycleRecord["commitIdentity"];
}): { record: ReviewFindingLifecycleRecord } | { reason: ReviewFindingLifecycleRejectionReason } {
  const filePath = normalizeRequiredString(input.finding.filePath);
  if (!filePath) return { reason: "missing-file-path" };
  if (isUnsafeFilePath(filePath)) return { reason: "unsafe-file-path" };

  const title = normalizeRequiredString(input.finding.title);
  if (!title) return { reason: "missing-title" };
  if (filePath.length > MAX_FILE_PATH_LENGTH || title.length > MAX_TITLE_LENGTH) return { reason: "field-too-long" };

  const lineRange = normalizeLineRange(input.finding.startLine, input.finding.endLine);
  if (lineRange === null) return { reason: "invalid-line-range" };

  if (hasUnsafeTextInput(input.finding)) return { reason: "unsafe-text" };

  const severity = normalizeSeverity(input.finding.severity);
  const category = normalizeCategory(input.finding.category);
  const confidence = normalizeConfidence(input.finding.confidence);
  const actionability = normalizeActionability(input.finding.actionability);
  const validationNeeds = normalizeValidationNeeds(input.finding.validationNeeds, category);
  const revalidationState = normalizeRevalidationState(input.finding.revalidationState);
  const evidenceRefs = normalizeEvidenceRefs(input.finding.evidenceRefs);
  const reasonCodes = normalizeReasonCodes(input.finding.reasonCodes, defaultReasonCode(actionability, validationNeeds));
  const statusHistory = normalizeStatusHistory(input.finding.statusHistory, {
    evidenceRefs,
    actionability,
    validationNeeds,
    revalidationState,
  });

  const identityHash = stableFindingIdentityHash({
    repo: input.repo,
    pullNumber: input.pullNumber,
    reviewOutputKey: input.reviewOutputKey,
    deliveryId: input.deliveryId,
    commitIdentity: input.commitIdentity,
    filePath,
    ...lineRange,
    category,
    title,
  });

  return {
    record: {
      id: `rfl-${identityHash.slice(0, 16)}`,
      identityHash,
      repo: input.repo,
      pullNumber: input.pullNumber,
      reviewOutputKey: input.reviewOutputKey,
      ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
      commitIdentity: input.commitIdentity,
      filePath,
      ...lineRange,
      severity,
      category,
      title,
      confidence,
      actionability,
      validationNeeds,
      revalidationState,
      statusHistory,
      evidenceRefs,
      reasonCodes,
    },
  };
}

function normalizeCommitIdentity(input: ReviewFindingLifecycleInput): ReviewFindingLifecycleRecord["commitIdentity"] {
  const commitSha = normalizeOptionalToken(input.commitSha);
  const headRef = normalizeOptionalToken(input.headRef);
  const baseRef = normalizeOptionalToken(input.baseRef);
  return {
    ...(commitSha ? { commitSha } : {}),
    ...(headRef ? { headRef } : {}),
    ...(baseRef ? { baseRef } : {}),
  };
}

function hasCommitIdentity(value: ReviewFindingLifecycleRecord["commitIdentity"]): boolean {
  return Boolean(value.commitSha || value.headRef || value.baseRef);
}

function stableFindingIdentityHash(input: {
  repo: string;
  pullNumber: number;
  reviewOutputKey: string;
  deliveryId?: string;
  commitIdentity: ReviewFindingLifecycleRecord["commitIdentity"];
  filePath: string;
  startLine?: number;
  endLine?: number;
  category: FindingCategory;
  title: string;
}): string {
  const canonical = [
    input.repo,
    input.pullNumber,
    input.reviewOutputKey,
    input.deliveryId ?? "",
    input.commitIdentity.commitSha ?? "",
    input.commitIdentity.headRef ?? "",
    input.commitIdentity.baseRef ?? "",
    input.filePath,
    input.startLine ?? "",
    input.endLine ?? "",
    input.category,
    input.title.toLowerCase().replace(/\s+/g, " ").trim(),
  ].join("\u001f");
  return createHash("sha256").update(canonical).digest("hex");
}

function normalizeRequiredString(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeOptionalToken(value: unknown): string | undefined {
  const normalized = normalizeRequiredString(value)
    .replace(/[^a-zA-Z0-9._:/@-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return normalized || undefined;
}

function normalizePullNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeLineRange(
  startLine: number | null | undefined,
  endLine: number | null | undefined,
): { startLine?: number; endLine?: number } | null {
  if (startLine === undefined || startLine === null) {
    return endLine === undefined || endLine === null ? {} : null;
  }
  if (!Number.isFinite(startLine) || startLine <= 0) return null;
  const start = Math.floor(startLine);
  if (endLine === undefined || endLine === null) return { startLine: start };
  if (!Number.isFinite(endLine) || endLine <= 0) return null;
  const end = Math.floor(endLine);
  return start <= end ? { startLine: start, endLine: end } : null;
}

function normalizeSeverity(value: unknown): FindingSeverity {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isOneOf(SEVERITY_VALUES, normalized) ? normalized : "medium";
}

function normalizeCategory(value: unknown): FindingCategory {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "error-handling") return "correctness";
  if (normalized === "resource-management" || normalized === "concurrency") return "performance";
  return isOneOf(CATEGORY_VALUES, normalized) ? normalized : "correctness";
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeActionability(value: unknown): ReviewFindingActionability {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isOneOf(ACTIONABILITY_VALUES, normalized) ? normalized : "needs-human-review";
}

function normalizeValidationNeeds(
  values: ReviewFindingInput["validationNeeds"],
  category: FindingCategory,
): ReviewFindingValidationNeed[] {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value) => typeof value === "string" ? value.trim().toLowerCase() : "")
    .filter((value): value is ReviewFindingValidationNeed => isOneOf(VALIDATION_NEED_VALUES, value))
    .filter((value) => value !== "none")
    .slice(0, MAX_VALIDATION_NEEDS);

  if (normalized.length > 0) return Array.from(new Set(normalized));
  if (category === "security") return ["needs-security-review"];
  return ["none"];
}

function normalizeRevalidationState(value: unknown): ReviewFindingRevalidationState {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isOneOf(REVALIDATION_STATE_VALUES, normalized) ? normalized : "not-required";
}

function normalizeStatusHistory(
  entries: ReviewFindingInput["statusHistory"],
  defaults: {
    evidenceRefs: ReviewFindingEvidenceReference[];
    actionability: ReviewFindingActionability;
    validationNeeds: ReviewFindingValidationNeed[];
    revalidationState: ReviewFindingRevalidationState;
  },
): ReviewFindingStatusHistoryEntry[] {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      if (!entry) return null;
      const statusValue = typeof entry.status === "string" ? entry.status.trim().toLowerCase() : "";
      if (!isOneOf(STATUS_VALUES, statusValue)) return null;
      return {
        status: statusValue,
        reasonCode: sanitizeReasonCode(entry.reasonCode) ?? defaultStatusReason(statusValue),
        evidenceRefs: normalizeEvidenceRefs(entry.evidenceRefs).slice(0, MAX_EVIDENCE_REFS),
      } satisfies ReviewFindingStatusHistoryEntry;
    })
    .filter((entry): entry is ReviewFindingStatusHistoryEntry => Boolean(entry))
    .slice(0, MAX_STATUS_HISTORY);

  if (normalized.length > 0) return normalized;

  const terminalStatus = defaults.actionability === "blocked"
    ? "blocked"
    : defaults.revalidationState === "failed"
      ? "degraded"
      : defaults.validationNeeds.some((need) => need !== "none")
        ? "validated"
        : "open";

  return [
    { status: "detected", reasonCode: "detected", evidenceRefs: defaults.evidenceRefs.slice(0, MAX_EVIDENCE_REFS) },
    { status: terminalStatus, reasonCode: defaultStatusReason(terminalStatus), evidenceRefs: defaults.evidenceRefs.slice(0, MAX_EVIDENCE_REFS) },
  ];
}

function normalizeEvidenceRefs(values: unknown): ReviewFindingEvidenceReference[] {
  if (!Array.isArray(values)) return [];
  const refs: ReviewFindingEvidenceReference[] = [];
  for (const value of values) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const record = value as Partial<ReviewFindingEvidenceReference>;
    const kind = record.kind;
    const ref = sanitizeEvidenceRef(record.ref);
    if ((kind === "file" || kind === "test" || kind === "log" || kind === "rule" || kind === "artifact") && ref) {
      refs.push({ kind, ref });
    }
    if (refs.length >= MAX_EVIDENCE_REFS) break;
  }
  return refs;
}

function normalizeReasonCodes(values: ReviewFindingInput["reasonCodes"], fallback: string): string[] {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value) => sanitizeReasonCode(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, MAX_REASON_CODES);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : [fallback];
}

function sanitizeReasonCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_REASON_CODE_LENGTH);
  return normalized || null;
}

function sanitizeEvidenceRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (containsUnsafeText(value)) return null;
  const normalized = value
    .trim()
    .replace(/[\r\n|]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_EVIDENCE_REF_LENGTH);
  return normalized || null;
}

function defaultReasonCode(
  actionability: ReviewFindingActionability,
  validationNeeds: ReviewFindingValidationNeed[],
): string {
  if (actionability === "blocked") return "blocked";
  const need = validationNeeds.find((value) => value !== "none");
  return need ?? "actionable";
}

function defaultStatusReason(status: ReviewFindingLifecycleStatus): string {
  if (status === "validated") return "validation-needed";
  if (status === "degraded") return "revalidation-failed";
  return status;
}

function isUnsafeFilePath(value: string): boolean {
  return value.startsWith("/") || value.includes("..") || /^[a-zA-Z]:[\\/]/.test(value);
}

function hasUnsafeTextInput(finding: ReviewFindingInput): boolean {
  return [
    finding.filePath,
    finding.title,
    finding.body,
    finding.rawPrompt,
    finding.rawModelOutput,
    finding.candidateBody,
    finding.diffText,
    ...((Array.isArray(finding.reasonCodes) ? finding.reasonCodes : []) as Array<string | null | undefined>),
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => containsUnsafeText(value));
}

function countUnsafeInputFields(findings: readonly ReviewFindingInput[]): number {
  return findings.reduce((count, finding) => count + countUnsafeFindingFields(finding), 0);
}

function countUnsafeFindingFields(finding: ReviewFindingInput): number {
  let count = 0;
  const values = [
    finding.body,
    finding.rawPrompt,
    finding.rawModelOutput,
    finding.candidateBody,
    finding.diffText,
    typeof finding.toolPayload === "string" ? finding.toolPayload : undefined,
  ];
  for (const value of values) {
    if (typeof value === "string" && containsUnsafeText(value)) count += 1;
  }
  if (finding.toolPayload !== undefined) count += 1;
  return count;
}

function containsUnsafeText(value: string): boolean {
  return /sk-[a-zA-Z0-9_-]{8,}/.test(value)
    || /gh[pousr]_[a-zA-Z0-9_]{8,}/.test(value)
    || /(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s]+/i.test(value)
    || /BEGIN\s+PROMPT|system prompt|hidden instructions|raw prompt/i.test(value)
    || /raw model output|model output/i.test(value)
    || /candidate body/i.test(value)
    || /tool payload/i.test(value)
    || /diff --git|@@\s+-\d+,?\d*\s+\+\d+,?\d*\s+@@/.test(value);
}

function createZeroCountRecord<const T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function incrementMap(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedReasonEntries(map: Map<string, number>): Array<[string, number]> {
  return Array.from(map.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function isOneOf<const T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}
