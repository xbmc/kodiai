import type { ReviewFindingLifecycleRecord } from "./finding-lifecycle.ts";

export type ValidationTruthReasonCode =
  | "suggested-but-open"
  | "validation-missing"
  | "validation-passed"
  | "validation-failed"
  | "validation-stale"
  | "revalidation-missing"
  | "revalidation-passed"
  | "revalidation-failed"
  | "degraded"
  | "blocked"
  | "resolved";

export type ValidationTruthStatus = "open" | "suggested" | "uncertain" | "blocked" | "degraded" | "resolved";

export type ValidationTruthEvidenceStatus = "passed" | "failed" | "blocked" | "degraded";

export type ValidationTruthCorrelation = {
  reviewOutputKey?: string | null;
  deliveryId?: string | null;
  repo?: string | null;
  pullNumber?: number | null;
};

export type SamePrFixTruthEvidence = ValidationTruthCorrelation & {
  findingId?: string | null;
  findingIdentityHash?: string | null;
  lifecycleId?: string | null;
  status?: "suggested" | "open" | "blocked" | "degraded" | null;
  suggested?: boolean | null;
  rawPrompt?: string | null;
  rawModelOutput?: string | null;
  candidateBody?: string | null;
  replacementText?: string | null;
  toolPayload?: unknown;
  diffText?: string | null;
};

export type ValidationTruthEvidence = ValidationTruthCorrelation & {
  findingId?: string | null;
  findingIdentityHash?: string | null;
  lifecycleId?: string | null;
  status?: ValidationTruthEvidenceStatus | null;
  evidenceFresh?: boolean | null;
  observedAtMs?: number | null;
  rawPayload?: unknown;
  rawPrompt?: string | null;
  rawModelOutput?: string | null;
  toolPayload?: unknown;
  diffText?: string | null;
};

export type ValidationTruthInput = ValidationTruthCorrelation & {
  findings?: ReadonlyArray<ReviewFindingLifecycleRecord | null | undefined> | null;
  samePrFixes?: ReadonlyArray<SamePrFixTruthEvidence | null | undefined> | null;
  validations?: ReadonlyArray<ValidationTruthEvidence | null | undefined> | null;
  revalidations?: ReadonlyArray<ValidationTruthEvidence | null | undefined> | null;
  requireRevalidation?: boolean | null;
};

export type ValidationTruthRecord = {
  id: string;
  identityHash: string;
  status: ValidationTruthStatus;
  reasonCodes: ValidationTruthReasonCode[];
  reviewOutputKey: string;
  deliveryId?: string;
  validationRequired: boolean;
  revalidationRequired: boolean;
  hasSuggestedFix: boolean;
  validation: {
    present: boolean;
    passed: boolean;
    fresh: boolean;
  };
  revalidation: {
    present: boolean;
    passed: boolean;
    fresh: boolean;
  };
};

export type ValidationTruthProjection = {
  schema: "review-validation-truth.v1";
  gate: "review-validation-truth";
  reviewOutputKey?: string;
  deliveryId?: string;
  status: "empty" | "normalized" | "degraded";
  counts: {
    detected: number;
    suggested: number;
    validated: number;
    revalidated: number;
    resolved: number;
    blocked: number;
    degraded: number;
    open: number;
    uncertain: number;
    inputFindings: number;
    unsafeInputFields: number;
  };
  reasonCounts: Partial<Record<ValidationTruthReasonCode, number>>;
  evidenceFreshness: {
    fresh: number;
    stale: number;
    missingValidation: number;
    missingRevalidation: number;
  };
  references: Array<{
    id: string;
    status: ValidationTruthStatus;
    reasonCodes: ValidationTruthReasonCode[];
    hasSuggestedFix: boolean;
    validationPresent: boolean;
    revalidationPresent: boolean;
  }>;
  omitted: {
    references: number;
    reasonCodes: number;
  };
  redaction: {
    privateOnly: true;
    rawPromptsIncluded: false;
    rawModelOutputIncluded: false;
    candidateBodiesIncluded: false;
    replacementTextIncluded: false;
    toolPayloadsIncluded: false;
    secretLikeStringsIncluded: false;
    diffsIncluded: false;
    unboundedArraysIncluded: false;
    unsafeInputFieldCount: number;
  };
};

export type ValidationTruthResult = {
  records: ValidationTruthRecord[];
  projection: ValidationTruthProjection;
};

const MAX_PUBLIC_REFERENCES = 5;
const MAX_PUBLIC_REASON_CODES = 8;
const MAX_REFERENCE_REASON_CODES = 4;
const REASON_ORDER: readonly ValidationTruthReasonCode[] = [
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
];

export function reduceValidationTruth(input: ValidationTruthInput): ValidationTruthResult {
  const findings = (Array.isArray(input.findings) ? input.findings : []).filter(
    (finding): finding is ReviewFindingLifecycleRecord => Boolean(finding),
  );
  const samePrFixes = (Array.isArray(input.samePrFixes) ? input.samePrFixes : []).filter(
    (evidence): evidence is SamePrFixTruthEvidence => Boolean(evidence),
  );
  const validations = (Array.isArray(input.validations) ? input.validations : []).filter(
    (evidence): evidence is ValidationTruthEvidence => Boolean(evidence),
  );
  const revalidations = (Array.isArray(input.revalidations) ? input.revalidations : []).filter(
    (evidence): evidence is ValidationTruthEvidence => Boolean(evidence),
  );

  const records = findings.map((finding) => reduceFindingTruth({
    finding,
    inputCorrelation: input,
    samePrFixes,
    validations,
    revalidations,
    requireRevalidation: input.requireRevalidation === true,
  }));

  return { records, projection: toValidationTruthProjection(records, input, findings.length, countUnsafeInputFields(input)) };
}

function reduceFindingTruth(input: {
  finding: ReviewFindingLifecycleRecord;
  inputCorrelation: ValidationTruthCorrelation;
  samePrFixes: SamePrFixTruthEvidence[];
  validations: ValidationTruthEvidence[];
  revalidations: ValidationTruthEvidence[];
  requireRevalidation: boolean;
}): ValidationTruthRecord {
  const { finding } = input;
  const suggestedFix = input.samePrFixes.find((evidence) => evidenceMatchesFinding(evidence, finding));
  const validation = input.validations.find((evidence) => evidenceMatchesFinding(evidence, finding));
  const revalidation = input.revalidations.find((evidence) => evidenceMatchesFinding(evidence, finding));
  const hasSuggestedFix = Boolean(suggestedFix && (suggestedFix.suggested === true || suggestedFix.status === "suggested"));
  const validationRequired = true;
  const revalidationRequired = input.requireRevalidation || finding.revalidationState !== "not-required";
  const reasonCodes: ValidationTruthReasonCode[] = [];

  const malformedCorrelation = !matchesReviewCorrelation(finding, input.inputCorrelation)
    || [suggestedFix, validation, revalidation].some((evidence) => evidence && !matchesReviewCorrelation(finding, evidence));

  if (malformedCorrelation || suggestedFix?.status === "degraded" || validation?.status === "degraded" || revalidation?.status === "degraded") {
    return truthRecord(finding, {
      status: "degraded",
      reasonCodes: ["degraded"],
      validationRequired,
      revalidationRequired,
      hasSuggestedFix,
      validation,
      revalidation,
    });
  }

  if (suggestedFix?.status === "blocked" || validation?.status === "blocked" || revalidation?.status === "blocked") {
    return truthRecord(finding, {
      status: "blocked",
      reasonCodes: ["blocked"],
      validationRequired,
      revalidationRequired,
      hasSuggestedFix,
      validation,
      revalidation,
    });
  }

  if (hasSuggestedFix) reasonCodes.push("suggested-but-open");

  if (!validation) {
    reasonCodes.push("validation-missing");
    return truthRecord(finding, {
      status: hasSuggestedFix ? "suggested" : "open",
      reasonCodes,
      validationRequired,
      revalidationRequired,
      hasSuggestedFix,
      validation,
      revalidation,
    });
  }

  if (validation.status === "failed") {
    reasonCodes.push("validation-failed");
    return truthRecord(finding, {
      status: "open",
      reasonCodes,
      validationRequired,
      revalidationRequired,
      hasSuggestedFix,
      validation,
      revalidation,
    });
  }

  if (!isFresh(validation)) {
    reasonCodes.push("validation-stale");
    return truthRecord(finding, {
      status: "uncertain",
      reasonCodes,
      validationRequired,
      revalidationRequired,
      hasSuggestedFix,
      validation,
      revalidation,
    });
  }

  reasonCodes.push("validation-passed");

  if (!revalidationRequired) {
    reasonCodes.push("resolved");
    return truthRecord(finding, {
      status: "resolved",
      reasonCodes,
      validationRequired,
      revalidationRequired,
      hasSuggestedFix,
      validation,
      revalidation,
    });
  }

  if (!revalidation) {
    reasonCodes.push("revalidation-missing");
    return truthRecord(finding, {
      status: "uncertain",
      reasonCodes,
      validationRequired,
      revalidationRequired,
      hasSuggestedFix,
      validation,
      revalidation,
    });
  }

  if (revalidation.status === "failed") {
    reasonCodes.push("revalidation-failed");
    return truthRecord(finding, {
      status: "open",
      reasonCodes,
      validationRequired,
      revalidationRequired,
      hasSuggestedFix,
      validation,
      revalidation,
    });
  }

  if (!isFresh(revalidation)) {
    reasonCodes.push("validation-stale");
    return truthRecord(finding, {
      status: "uncertain",
      reasonCodes,
      validationRequired,
      revalidationRequired,
      hasSuggestedFix,
      validation,
      revalidation,
    });
  }

  reasonCodes.push("revalidation-passed", "resolved");
  return truthRecord(finding, {
    status: "resolved",
    reasonCodes,
    validationRequired,
    revalidationRequired,
    hasSuggestedFix,
    validation,
    revalidation,
  });
}

function truthRecord(
  finding: ReviewFindingLifecycleRecord,
  input: {
    status: ValidationTruthStatus;
    reasonCodes: ValidationTruthReasonCode[];
    validationRequired: boolean;
    revalidationRequired: boolean;
    hasSuggestedFix: boolean;
    validation?: ValidationTruthEvidence;
    revalidation?: ValidationTruthEvidence;
  },
): ValidationTruthRecord {
  return {
    id: finding.id,
    identityHash: finding.identityHash,
    status: input.status,
    reasonCodes: uniqueReasons(input.reasonCodes),
    reviewOutputKey: finding.reviewOutputKey,
    ...(finding.deliveryId ? { deliveryId: finding.deliveryId } : {}),
    validationRequired: input.validationRequired,
    revalidationRequired: input.revalidationRequired,
    hasSuggestedFix: input.hasSuggestedFix,
    validation: {
      present: Boolean(input.validation),
      passed: input.validation?.status === "passed" && isFresh(input.validation),
      fresh: input.validation ? isFresh(input.validation) : false,
    },
    revalidation: {
      present: Boolean(input.revalidation),
      passed: input.revalidation?.status === "passed" && isFresh(input.revalidation),
      fresh: input.revalidation ? isFresh(input.revalidation) : false,
    },
  };
}

function toValidationTruthProjection(
  records: ValidationTruthRecord[],
  correlation: ValidationTruthCorrelation,
  inputFindings: number,
  unsafeInputFields: number,
): ValidationTruthProjection {
  const reasonCounts = new Map<ValidationTruthReasonCode, number>();
  const counts = {
    detected: inputFindings,
    suggested: 0,
    validated: 0,
    revalidated: 0,
    resolved: 0,
    blocked: 0,
    degraded: 0,
    open: 0,
    uncertain: 0,
    inputFindings,
    unsafeInputFields,
  };
  const evidenceFreshness = {
    fresh: 0,
    stale: 0,
    missingValidation: 0,
    missingRevalidation: 0,
  };

  for (const record of records) {
    if (record.hasSuggestedFix) counts.suggested += 1;
    if (record.validation.passed) counts.validated += 1;
    if (record.revalidation.passed) counts.revalidated += 1;
    if (record.status !== "suggested") counts[record.status] += 1;
    if (record.validation.present || record.revalidation.present) {
      if (record.validation.fresh || record.revalidation.fresh) evidenceFreshness.fresh += 1;
      if ((record.validation.present && !record.validation.fresh) || (record.revalidation.present && !record.revalidation.fresh)) {
        evidenceFreshness.stale += 1;
      }
    }
    if (record.validationRequired && !record.validation.present) evidenceFreshness.missingValidation += 1;
    if (record.revalidationRequired && !record.revalidation.present) evidenceFreshness.missingRevalidation += 1;
    for (const reason of record.reasonCodes) incrementReason(reasonCounts, reason);
  }

  const orderedReasons = orderedReasonCounts(reasonCounts);
  const references = records.slice(0, MAX_PUBLIC_REFERENCES).map((record) => ({
    id: record.id,
    status: record.status,
    reasonCodes: record.reasonCodes.slice(0, MAX_REFERENCE_REASON_CODES),
    hasSuggestedFix: record.hasSuggestedFix,
    validationPresent: record.validation.present,
    revalidationPresent: record.revalidation.present,
  }));

  return {
    schema: "review-validation-truth.v1",
    gate: "review-validation-truth",
    ...optionalToken("reviewOutputKey", correlation.reviewOutputKey),
    ...optionalToken("deliveryId", correlation.deliveryId),
    status: records.length === 0 ? "empty" : records.some((record) => record.status === "degraded") ? "degraded" : "normalized",
    counts,
    reasonCounts: Object.fromEntries(orderedReasons.slice(0, MAX_PUBLIC_REASON_CODES)) as Partial<Record<ValidationTruthReasonCode, number>>,
    evidenceFreshness,
    references,
    omitted: {
      references: Math.max(0, records.length - references.length),
      reasonCodes: Math.max(0, orderedReasons.length - MAX_PUBLIC_REASON_CODES),
    },
    redaction: {
      privateOnly: true,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      candidateBodiesIncluded: false,
      replacementTextIncluded: false,
      toolPayloadsIncluded: false,
      secretLikeStringsIncluded: false,
      diffsIncluded: false,
      unboundedArraysIncluded: false,
      unsafeInputFieldCount: unsafeInputFields,
    },
  };
}

function evidenceMatchesFinding(
  evidence: SamePrFixTruthEvidence | ValidationTruthEvidence,
  finding: ReviewFindingLifecycleRecord,
): boolean {
  return evidence.findingId === finding.id
    || evidence.findingIdentityHash === finding.identityHash
    || evidence.lifecycleId === finding.id
    || evidence.lifecycleId === finding.identityHash;
}

function matchesReviewCorrelation(
  finding: ReviewFindingLifecycleRecord,
  correlation: ValidationTruthCorrelation,
): boolean {
  const reviewOutputKey = normalizeOptionalString(correlation.reviewOutputKey);
  const deliveryId = normalizeOptionalString(correlation.deliveryId);
  const repo = normalizeOptionalString(correlation.repo);
  const pullNumber = normalizePullNumber(correlation.pullNumber);

  if (reviewOutputKey && reviewOutputKey !== finding.reviewOutputKey) return false;
  if (deliveryId && deliveryId !== finding.deliveryId) return false;
  if (repo && repo !== finding.repo) return false;
  if (pullNumber > 0 && pullNumber !== finding.pullNumber) return false;
  return true;
}

function isFresh(evidence: ValidationTruthEvidence): boolean {
  return evidence.evidenceFresh !== false;
}

function uniqueReasons(reasons: readonly ValidationTruthReasonCode[]): ValidationTruthReasonCode[] {
  return Array.from(new Set(reasons));
}

function countUnsafeInputFields(input: ValidationTruthInput): number {
  const fixFields = (Array.isArray(input.samePrFixes) ? input.samePrFixes : []).reduce(
    (count, evidence) => count + countUnsafeFields(evidence),
    0,
  );
  const validationFields = (Array.isArray(input.validations) ? input.validations : []).reduce(
    (count, evidence) => count + countUnsafeFields(evidence),
    0,
  );
  const revalidationFields = (Array.isArray(input.revalidations) ? input.revalidations : []).reduce(
    (count, evidence) => count + countUnsafeFields(evidence),
    0,
  );
  return fixFields + validationFields + revalidationFields;
}

function countUnsafeFields(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  let count = 0;
  for (const key of ["rawPrompt", "rawModelOutput", "candidateBody", "replacementText", "diffText"] as const) {
    if (typeof record[key] === "string") count += 1;
  }
  for (const key of ["toolPayload", "rawPayload"] as const) {
    if (record[key] !== undefined) count += 1;
  }
  return count;
}

function incrementReason(map: Map<ValidationTruthReasonCode, number>, reason: ValidationTruthReasonCode): void {
  map.set(reason, (map.get(reason) ?? 0) + 1);
}

function orderedReasonCounts(map: Map<ValidationTruthReasonCode, number>): Array<[ValidationTruthReasonCode, number]> {
  return Array.from(map.entries()).sort((left, right) => {
    const countSort = right[1] - left[1];
    if (countSort !== 0) return countSort;
    return REASON_ORDER.indexOf(left[0]) - REASON_ORDER.indexOf(right[0]);
  });
}

function optionalToken<K extends "reviewOutputKey" | "deliveryId">(key: K, value: unknown): Partial<Record<K, string>> {
  const normalized = normalizeOptionalString(value);
  return normalized ? { [key]: normalized } as Partial<Record<K, string>> : {};
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().replace(/\s+/g, " ") : undefined;
}

function normalizePullNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
