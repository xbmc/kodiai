export type CandidateVerificationState =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "disproven";

export type CandidateVerificationConflictFlag =
  | "duplicate"
  | "disagreement"
  | "unclassifiable";

export type CandidateVerificationFailClosedStatus = "pass" | "fail_closed";

export type CandidateVerificationReasonCategory =
  | "candidate-missing-key"
  | "candidate-duplicate-key"
  | "evidence-missing-key"
  | "evidence-duplicate-key"
  | "evidence-conflict"
  | "evidence-contradiction"
  | "evidence-unrecognized"
  | "malformed-input"
  | "input-truncated"
  | "no-evidence"
  | "partial-support"
  | "full-support";

export type NormalReviewCandidateAggregateInput = {
  readonly candidates?: unknown;
  readonly deliveryId?: unknown;
  readonly reviewOutputKey?: unknown;
  readonly correlationKey?: unknown;
  readonly [key: string]: unknown;
};

export type DocsConfigSpecialistAggregateInput = {
  readonly evidence?: unknown;
  readonly candidates?: unknown;
  readonly decisions?: unknown;
  readonly deliveryId?: unknown;
  readonly reviewOutputKey?: unknown;
  readonly correlationKey?: unknown;
  readonly [key: string]: unknown;
};

export type CandidateVerificationClassifierInput = {
  readonly normalReview?: NormalReviewCandidateAggregateInput | null;
  readonly docsConfigTruth?: DocsConfigSpecialistAggregateInput | null;
};

export type CandidateVerificationRedactionFlags = {
  readonly privateOnly: true;
  readonly candidateBodiesIncluded: false;
  readonly specialistProseIncluded: false;
  readonly rawPromptsIncluded: false;
  readonly rawModelOutputIncluded: false;
  readonly diffsIncluded: false;
  readonly evidencePayloadsIncluded: false;
  readonly rawFingerprintsIncluded: false;
  readonly unsafeInputFieldCount: number;
  readonly discardedRawPayload: boolean;
  readonly discardedPublicationFields: boolean;
  readonly discardedEvidencePayloads: boolean;
};

export type CandidateVerificationCandidateResult = {
  readonly candidateRef: string;
  readonly verificationState: CandidateVerificationState;
  readonly publicationEligible: boolean;
  readonly conflictFlags: readonly CandidateVerificationConflictFlag[];
  readonly reasonCategories: readonly CandidateVerificationReasonCategory[];
  readonly hasCandidateKey: boolean;
  readonly hasEvidenceKey: boolean;
  readonly evidenceCount: number;
  readonly duplicateEvidenceCount: number;
  readonly disagreementCount: number;
  readonly unclassifiableEvidenceCount: number;
  readonly contradictionEvidenceCount: number;
  readonly privateOnly: true;
};

export type CandidateVerificationCounts = {
  readonly candidateCount: number;
  readonly evidenceCount: number;
  readonly verifiedCount: number;
  readonly partiallyVerifiedCount: number;
  readonly unverifiedCount: number;
  readonly disprovenCount: number;
  readonly publicationEligibleCount: number;
  readonly duplicateCount: number;
  readonly disagreementCount: number;
  readonly unclassifiableCount: number;
  readonly malformedRecordCount: number;
  readonly truncatedCandidateCount: number;
  readonly truncatedEvidenceCount: number;
};

export type CandidateVerificationResult = {
  readonly status: CandidateVerificationFailClosedStatus;
  readonly candidates: readonly CandidateVerificationCandidateResult[];
  readonly counts: CandidateVerificationCounts;
  readonly reasonCategories: readonly CandidateVerificationReasonCategory[];
  readonly hasDeliveryId: boolean;
  readonly hasReviewOutputKey: boolean;
  readonly hasCorrelationKey: boolean;
  readonly redactionFlags: CandidateVerificationRedactionFlags;
  readonly privateOnly: true;
  readonly publishesFindings: false;
};

type MutableRedactionFlags = {
  -readonly [K in keyof CandidateVerificationRedactionFlags]: CandidateVerificationRedactionFlags[K];
};

type MutableCounts = {
  -readonly [K in keyof CandidateVerificationCounts]: CandidateVerificationCounts[K];
};

type NormalizedCandidate = {
  readonly key: string | null;
  readonly duplicate: boolean;
  readonly malformed: boolean;
};

type EvidenceDecision = "support" | "partial" | "neutral" | "contradiction" | "unknown";

type NormalizedEvidence = {
  readonly candidateKey: string | null;
  readonly decision: EvidenceDecision;
  readonly signature: string;
  readonly malformed: boolean;
};

type CandidateAccumulator = {
  evidenceCount: number;
  supportCount: number;
  partialCount: number;
  neutralCount: number;
  contradictionCount: number;
  duplicateCount: number;
  disagreementCount: number;
  unclassifiableCount: number;
  hasEvidenceKey: boolean;
  reasons: CandidateVerificationReasonCategory[];
  conflicts: CandidateVerificationConflictFlag[];
};

const MAX_CANDIDATES = 25;
const MAX_EVIDENCE = 100;
const MAX_KEY_LENGTH = 128;

const SUPPORT_DECISIONS = new Set(["verified", "verify", "supported", "support", "matches", "match", "candidate"]);
const PARTIAL_DECISIONS = new Set(["partially_verified", "partial", "partially-supported", "partially_supported"]);
const NEUTRAL_DECISIONS = new Set(["unverified", "unknown", "none", "dismissed", "not_found", "not-found"]);
const CONTRADICTION_DECISIONS = new Set(["disproven", "contradiction", "contradicted", "false", "invalid"]);
const DISAGREEMENT_DECISIONS = new Set(["disagreement", "conflict", "conflicting"]);

const RAW_PAYLOAD_KEYS = new Set([
  "prompt",
  "rawPrompt",
  "systemPrompt",
  "modelOutput",
  "modelText",
  "rawModelOutput",
  "toolPayload",
  "toolResult",
  "toolResults",
  "messages",
]);

const PUBLICATION_KEYS = new Set([
  "body",
  "commentBody",
  "githubCommentBody",
  "inlineComment",
  "inlineComments",
  "suggestion",
  "finding",
  "findings",
  "specialistProse",
  "prose",
]);

const EVIDENCE_PAYLOAD_KEYS = new Set([
  "diff",
  "patch",
  "fingerprint",
  "rawFingerprint",
  "payload",
  "evidencePayload",
  "rawEvidence",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, MAX_KEY_LENGTH) : null;
}

function firstKey(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = normalizeKey(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function normalizeDecision(value: unknown): EvidenceDecision {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (SUPPORT_DECISIONS.has(normalized)) {
    return "support";
  }
  if (PARTIAL_DECISIONS.has(normalized)) {
    return "partial";
  }
  if (NEUTRAL_DECISIONS.has(normalized)) {
    return "neutral";
  }
  if (CONTRADICTION_DECISIONS.has(normalized)) {
    return "contradiction";
  }
  if (DISAGREEMENT_DECISIONS.has(normalized)) {
    return "contradiction";
  }
  return "unknown";
}

function appendUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function detectUnsafeFields(value: unknown): CandidateVerificationRedactionFlags {
  const flags: MutableRedactionFlags = {
    privateOnly: true,
    candidateBodiesIncluded: false,
    specialistProseIncluded: false,
    rawPromptsIncluded: false,
    rawModelOutputIncluded: false,
    diffsIncluded: false,
    evidencePayloadsIncluded: false,
    rawFingerprintsIncluded: false,
    unsafeInputFieldCount: 0,
    discardedRawPayload: false,
    discardedPublicationFields: false,
    discardedEvidencePayloads: false,
  };

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry);
      }
      return;
    }
    if (!isRecord(node)) {
      return;
    }
    for (const [key, nested] of Object.entries(node)) {
      const normalizedKey = key.trim();
      if (RAW_PAYLOAD_KEYS.has(normalizedKey)) {
        flags.unsafeInputFieldCount++;
        flags.discardedRawPayload = true;
      }
      if (PUBLICATION_KEYS.has(normalizedKey)) {
        flags.unsafeInputFieldCount++;
        flags.discardedPublicationFields = true;
      }
      if (EVIDENCE_PAYLOAD_KEYS.has(normalizedKey)) {
        flags.unsafeInputFieldCount++;
        flags.discardedEvidencePayloads = true;
      }
      visit(nested);
    }
  };

  visit(value);
  return flags;
}

function extractArray(value: unknown): { values: readonly unknown[]; malformed: boolean } {
  if (value == null) {
    return { values: [], malformed: false };
  }
  return Array.isArray(value)
    ? { values: value, malformed: false }
    : { values: [], malformed: true };
}

function normalizeCandidates(input: NormalReviewCandidateAggregateInput | null | undefined): {
  candidates: readonly NormalizedCandidate[];
  malformedRecordCount: number;
  truncatedCandidateCount: number;
} {
  const aggregate = isRecord(input) ? input : {};
  const { values, malformed } = extractArray(aggregate.candidates);
  const seenKeys = new Set<string>();
  const candidates: NormalizedCandidate[] = [];
  let malformedRecordCount = malformed || !isRecord(input) ? 1 : 0;

  for (const rawCandidate of values.slice(0, MAX_CANDIDATES)) {
    if (!isRecord(rawCandidate)) {
      malformedRecordCount++;
      candidates.push({ key: null, duplicate: false, malformed: true });
      continue;
    }
    const key = firstKey(rawCandidate, ["candidateKey", "key", "id", "fingerprint"]);
    const duplicate = key !== null && seenKeys.has(key);
    if (key !== null) {
      seenKeys.add(key);
    }
    if (key === null) {
      malformedRecordCount++;
    }
    candidates.push({ key, duplicate, malformed: key === null });
  }

  return {
    candidates,
    malformedRecordCount,
    truncatedCandidateCount: Math.max(0, values.length - MAX_CANDIDATES),
  };
}

function evidenceSource(input: DocsConfigSpecialistAggregateInput | null | undefined): unknown {
  if (!isRecord(input)) {
    return undefined;
  }
  return input.evidence ?? input.candidates ?? input.decisions;
}

function normalizeEvidence(input: DocsConfigSpecialistAggregateInput | null | undefined): {
  evidence: readonly NormalizedEvidence[];
  malformedRecordCount: number;
  truncatedEvidenceCount: number;
} {
  const source = evidenceSource(input);
  const { values, malformed } = extractArray(source);
  let malformedRecordCount = malformed || !isRecord(input) ? 1 : 0;
  const evidence: NormalizedEvidence[] = [];

  for (let index = 0; index < values.slice(0, MAX_EVIDENCE).length; index++) {
    const rawEvidence = values[index];
    if (!isRecord(rawEvidence)) {
      malformedRecordCount++;
      evidence.push({ candidateKey: null, decision: "unknown", signature: `malformed:${index}`, malformed: true });
      continue;
    }
    const candidateKey = firstKey(rawEvidence, ["candidateKey", "key", "id", "fingerprint"]);
    const decision = normalizeDecision(rawEvidence.decision ?? rawEvidence.status ?? rawEvidence.verificationState);
    const lane = normalizeKey(rawEvidence.laneId) ?? normalizeKey(rawEvidence.source) ?? "docs-config-truth";
    const evidenceId = normalizeKey(rawEvidence.evidenceId) ?? normalizeKey(rawEvidence.id) ?? "";
    const signature = `${candidateKey ?? "missing"}:${decision}:${lane}:${evidenceId}`;
    const malformedRecord = candidateKey === null || decision === "unknown";
    if (malformedRecord) {
      malformedRecordCount++;
    }
    evidence.push({ candidateKey, decision, signature, malformed: malformedRecord });
  }

  return {
    evidence,
    malformedRecordCount,
    truncatedEvidenceCount: Math.max(0, values.length - MAX_EVIDENCE),
  };
}

function emptyAccumulator(): CandidateAccumulator {
  return {
    evidenceCount: 0,
    supportCount: 0,
    partialCount: 0,
    neutralCount: 0,
    contradictionCount: 0,
    duplicateCount: 0,
    disagreementCount: 0,
    unclassifiableCount: 0,
    hasEvidenceKey: false,
    reasons: [],
    conflicts: [],
  };
}

function addConflict(accumulator: CandidateAccumulator, conflict: CandidateVerificationConflictFlag): void {
  appendUnique(accumulator.conflicts, conflict);
}

function addReason(accumulator: CandidateAccumulator, reason: CandidateVerificationReasonCategory): void {
  appendUnique(accumulator.reasons, reason);
}

function applyEvidence(accumulator: CandidateAccumulator, evidence: NormalizedEvidence): void {
  accumulator.evidenceCount++;
  accumulator.hasEvidenceKey = evidence.candidateKey !== null;

  switch (evidence.decision) {
    case "support":
      accumulator.supportCount++;
      addReason(accumulator, "full-support");
      break;
    case "partial":
      accumulator.partialCount++;
      addReason(accumulator, "partial-support");
      break;
    case "neutral":
      accumulator.neutralCount++;
      break;
    case "contradiction":
      accumulator.contradictionCount++;
      accumulator.disagreementCount++;
      addConflict(accumulator, "disagreement");
      addReason(accumulator, "evidence-contradiction");
      addReason(accumulator, "evidence-conflict");
      break;
    case "unknown":
      accumulator.unclassifiableCount++;
      addConflict(accumulator, "unclassifiable");
      addReason(accumulator, "evidence-unrecognized");
      break;
  }
}

function classifyAccumulator(accumulator: CandidateAccumulator, candidate: NormalizedCandidate): {
  verificationState: CandidateVerificationState;
  publicationEligible: boolean;
} {
  if (candidate.key === null) {
    return { verificationState: "unverified", publicationEligible: false };
  }
  if (accumulator.contradictionCount > 0) {
    return { verificationState: "disproven", publicationEligible: false };
  }
  if (accumulator.unclassifiableCount > 0 || candidate.duplicate) {
    return { verificationState: "unverified", publicationEligible: false };
  }
  if (accumulator.evidenceCount === 0 || accumulator.neutralCount > 0) {
    return { verificationState: "unverified", publicationEligible: false };
  }
  if (accumulator.supportCount > 0 && accumulator.partialCount === 0) {
    return { verificationState: "verified", publicationEligible: true };
  }
  if (accumulator.supportCount > 0 || accumulator.partialCount > 0) {
    return { verificationState: "partially_verified", publicationEligible: true };
  }
  return { verificationState: "unverified", publicationEligible: false };
}

function emptyCounts(overrides?: Partial<CandidateVerificationCounts>): MutableCounts {
  return {
    candidateCount: 0,
    evidenceCount: 0,
    verifiedCount: 0,
    partiallyVerifiedCount: 0,
    unverifiedCount: 0,
    disprovenCount: 0,
    publicationEligibleCount: 0,
    duplicateCount: 0,
    disagreementCount: 0,
    unclassifiableCount: 0,
    malformedRecordCount: 0,
    truncatedCandidateCount: 0,
    truncatedEvidenceCount: 0,
    ...overrides,
  };
}

function hasBoundedString(value: unknown): boolean {
  return normalizeKey(value) !== null;
}

export function classifyCandidateVerification(
  input: CandidateVerificationClassifierInput | null | undefined,
): CandidateVerificationResult {
  const safeInput = isRecord(input) ? input : {};
  const normalReview = isRecord(safeInput.normalReview) ? safeInput.normalReview : null;
  const docsConfigTruth = isRecord(safeInput.docsConfigTruth) ? safeInput.docsConfigTruth : null;
  const redactionFlags = detectUnsafeFields(safeInput);
  const topLevelMalformedCount = isRecord(input) ? 0 : 1;
  const normalizedCandidates = normalizeCandidates(normalReview);
  const normalizedEvidence = normalizeEvidence(docsConfigTruth);
  const globalReasons: CandidateVerificationReasonCategory[] = [];

  if (topLevelMalformedCount > 0 || normalizedCandidates.malformedRecordCount > 0 || normalizedEvidence.malformedRecordCount > 0) {
    appendUnique(globalReasons, "malformed-input");
  }
  if (normalizedCandidates.truncatedCandidateCount > 0 || normalizedEvidence.truncatedEvidenceCount > 0) {
    appendUnique(globalReasons, "input-truncated");
  }

  const evidenceByCandidate = new Map<string, NormalizedEvidence[]>();
  let unmatchedEvidenceCount = 0;
  let duplicateEvidenceCount = 0;
  const seenEvidenceSignatures = new Set<string>();
  const globalEvidenceAccumulator = emptyAccumulator();

  for (const evidence of normalizedEvidence.evidence) {
    if (seenEvidenceSignatures.has(evidence.signature)) {
      duplicateEvidenceCount++;
      continue;
    }
    seenEvidenceSignatures.add(evidence.signature);

    if (evidence.candidateKey === null) {
      unmatchedEvidenceCount++;
      globalEvidenceAccumulator.unclassifiableCount++;
      addConflict(globalEvidenceAccumulator, "unclassifiable");
      addReason(globalEvidenceAccumulator, "evidence-missing-key");
      continue;
    }

    const current = evidenceByCandidate.get(evidence.candidateKey);
    if (current) {
      current.push(evidence);
    } else {
      evidenceByCandidate.set(evidence.candidateKey, [evidence]);
    }
  }

  const candidates: CandidateVerificationCandidateResult[] = [];
  const counts = emptyCounts({
    candidateCount: normalizedCandidates.candidates.length,
    evidenceCount: normalizedEvidence.evidence.length,
    duplicateCount: duplicateEvidenceCount,
    unclassifiableCount: globalEvidenceAccumulator.unclassifiableCount,
    malformedRecordCount: topLevelMalformedCount
      + normalizedCandidates.malformedRecordCount
      + normalizedEvidence.malformedRecordCount,
    truncatedCandidateCount: normalizedCandidates.truncatedCandidateCount,
    truncatedEvidenceCount: normalizedEvidence.truncatedEvidenceCount,
  });

  normalizedCandidates.candidates.forEach((candidate, index) => {
    const accumulator = emptyAccumulator();
    if (candidate.key === null) {
      addConflict(accumulator, "unclassifiable");
      addReason(accumulator, "candidate-missing-key");
      addReason(accumulator, "malformed-input");
    }
    if (candidate.duplicate) {
      accumulator.duplicateCount++;
      addConflict(accumulator, "duplicate");
      addReason(accumulator, "candidate-duplicate-key");
    }

    for (const evidence of candidate.key === null ? [] : evidenceByCandidate.get(candidate.key) ?? []) {
      applyEvidence(accumulator, evidence);
    }

    if (duplicateEvidenceCount > 0) {
      accumulator.duplicateCount += duplicateEvidenceCount;
      addConflict(accumulator, "duplicate");
      addReason(accumulator, "evidence-duplicate-key");
    }

    const hasConflictingPositiveAndNegative = accumulator.contradictionCount > 0
      && (accumulator.supportCount > 0 || accumulator.partialCount > 0);
    if (hasConflictingPositiveAndNegative) {
      accumulator.disagreementCount++;
      addConflict(accumulator, "disagreement");
      addReason(accumulator, "evidence-conflict");
    }

    if (accumulator.evidenceCount === 0 && candidate.key !== null) {
      addReason(accumulator, "no-evidence");
    }

    const { verificationState, publicationEligible } = classifyAccumulator(accumulator, candidate);
    switch (verificationState) {
      case "verified":
        counts.verifiedCount++;
        break;
      case "partially_verified":
        counts.partiallyVerifiedCount++;
        break;
      case "unverified":
        counts.unverifiedCount++;
        break;
      case "disproven":
        counts.disprovenCount++;
        break;
    }
    if (publicationEligible) {
      counts.publicationEligibleCount++;
    }
    counts.duplicateCount += accumulator.duplicateCount;
    counts.disagreementCount += accumulator.disagreementCount;
    counts.unclassifiableCount += accumulator.unclassifiableCount + (candidate.malformed ? 1 : 0);

    for (const reason of accumulator.reasons) {
      appendUnique(globalReasons, reason);
    }

    candidates.push({
      candidateRef: `candidate-${index + 1}`,
      verificationState,
      publicationEligible,
      conflictFlags: accumulator.conflicts,
      reasonCategories: accumulator.reasons,
      hasCandidateKey: candidate.key !== null,
      hasEvidenceKey: accumulator.hasEvidenceKey,
      evidenceCount: accumulator.evidenceCount,
      duplicateEvidenceCount: accumulator.duplicateCount,
      disagreementCount: accumulator.disagreementCount,
      unclassifiableEvidenceCount: accumulator.unclassifiableCount,
      contradictionEvidenceCount: accumulator.contradictionCount,
      privateOnly: true,
    });
  });

  if (normalizedCandidates.candidates.length === 0) {
    appendUnique(globalReasons, "no-evidence");
  }
  if (unmatchedEvidenceCount > 0) {
    appendUnique(globalReasons, "evidence-missing-key");
  }

  const status: CandidateVerificationFailClosedStatus = counts.publicationEligibleCount === counts.candidateCount
    && counts.candidateCount > 0
    && counts.duplicateCount === 0
    && counts.disagreementCount === 0
    && counts.unclassifiableCount === 0
    && counts.malformedRecordCount === 0
    ? "pass"
    : "fail_closed";

  return {
    status,
    candidates,
    counts,
    reasonCategories: globalReasons,
    hasDeliveryId: hasBoundedString(normalReview?.deliveryId) || hasBoundedString(docsConfigTruth?.deliveryId),
    hasReviewOutputKey: hasBoundedString(normalReview?.reviewOutputKey) || hasBoundedString(docsConfigTruth?.reviewOutputKey),
    hasCorrelationKey: hasBoundedString(normalReview?.correlationKey) || hasBoundedString(docsConfigTruth?.correlationKey),
    redactionFlags,
    privateOnly: true,
    publishesFindings: false,
  };
}
