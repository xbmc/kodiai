export const CONTINUATION_COMPACTION_STATUSES = [
  "compacted",
  "fallback",
  "degraded",
  "bypass",
] as const;

export const CONTINUATION_COMPACTION_REASONS = [
  "safe-delta-reuse",
  "missing-checkpoint",
  "missing-budget-signal",
  "degraded-cache-signal",
  "unsafe-cache-state",
  "malformed-prior-state",
  "no-remaining-scope",
] as const;

export const CONTINUATION_COMPACTION_FALLBACK_STATES = [
  "none",
  "fuller-context",
  "partial-context",
] as const;

export const CONTINUATION_COMPACTION_CHECK_IDS = [
  "fixture.shape",
  "compaction-observations.present",
  "vocabulary.bounded",
  "attempt-identity.valid",
  "decision-safety.valid",
  "totals.deterministic",
  "redaction.safe",
] as const;

export type ContinuationCompactionStatus = typeof CONTINUATION_COMPACTION_STATUSES[number];
export type ContinuationCompactionReason = typeof CONTINUATION_COMPACTION_REASONS[number];
export type ContinuationCompactionFallbackState = typeof CONTINUATION_COMPACTION_FALLBACK_STATES[number];
export type ContinuationCompactionCheckId = typeof CONTINUATION_COMPACTION_CHECK_IDS[number];
export type ContinuationCompactionCheckStatus = "pass" | "fail";

export type ContinuationCompactionObservation = {
  readonly caseId: string;
  readonly deliveryId: string;
  readonly repo: string;
  readonly attemptId: string;
  readonly priorAttemptId?: string;
  readonly attemptOrdinal?: number;
  readonly status: ContinuationCompactionStatus;
  readonly reason: ContinuationCompactionReason;
  readonly fallbackState: ContinuationCompactionFallbackState;
  readonly includedDeltaCount: number;
  readonly reusedCheckpointCount: number;
  readonly omittedScopeCount: number;
  readonly remainingScopeCount: number;
  readonly budgetSignalNames?: readonly string[];
  readonly cacheSignalNames?: readonly string[];
  readonly missingSignalNames?: readonly string[];
  readonly safetySignalNames?: readonly string[];
};

export type ContinuationCompactionSummary = {
  readonly observationCount: number;
  readonly deliveryCount: number;
  readonly attemptCount: number;
  readonly statusCounts: Record<ContinuationCompactionStatus, number>;
  readonly reasonCounts: Record<ContinuationCompactionReason, number>;
  readonly fallbackStateCounts: Record<ContinuationCompactionFallbackState, number>;
  readonly includedDeltaCount: number;
  readonly reusedCheckpointCount: number;
  readonly omittedScopeCount: number;
  readonly remainingScopeCount: number;
  readonly safetySignalNames: readonly string[];
  readonly budgetSignalNames: readonly string[];
  readonly cacheSignalNames: readonly string[];
  readonly missingSignalNames: readonly string[];
};

export type ContinuationCompactionFixture = {
  readonly generatedAt?: string;
  readonly continuationCompactionObservations: readonly ContinuationCompactionObservation[];
  readonly continuationCompactionSummary: ContinuationCompactionSummary;
};

export type ContinuationCompactionCheck = {
  readonly id: ContinuationCompactionCheckId;
  readonly status: ContinuationCompactionCheckStatus;
  readonly message: string;
  readonly issues: readonly string[];
};

export type ContinuationCompactionEvaluation = {
  readonly status: ContinuationCompactionCheckStatus;
  readonly checks: readonly ContinuationCompactionCheck[];
  readonly totals: ContinuationCompactionSummary;
};

const ALLOWED_STATUSES = new Set<ContinuationCompactionStatus>(CONTINUATION_COMPACTION_STATUSES);
const ALLOWED_REASONS = new Set<ContinuationCompactionReason>(CONTINUATION_COMPACTION_REASONS);
const ALLOWED_FALLBACK_STATES = new Set<ContinuationCompactionFallbackState>(CONTINUATION_COMPACTION_FALLBACK_STATES);
const MAX_ISSUES = 20;
const MAX_BOUNDED_STRING_LENGTH = 160;
const BOUNDED_IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,119}$/;
const BOUNDED_SIGNAL_NAME = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const FORBIDDEN_RAW_TEXT_KEYS = /(^|_)(rawPrompt|promptText|prompt|diff|diffHunk|hunk|patch|comment|commentBody|body|candidate|candidateText|candidatePayload|modelOutput|completion|content|text|retrievalText|retrievalChunk|retrievalChunks|chunkText)$/i;
const FORBIDDEN_RAW_FINGERPRINT_KEYS = /(^|_)(fingerprint|rawFingerprint|fingerprintHash|promptHash|diffHash|cacheKey|cacheKeyHash|embedding|embeddingVector|vector)$/i;
const SECRET_LIKE_VALUE = /(ghp_|github_pat_|sk-[a-z0-9]|azure[_-]?client[_-]?secret|password\s*=|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

export function evaluateContinuationCompactionFixture(fixture: unknown): ContinuationCompactionEvaluation {
  const checks: ContinuationCompactionCheck[] = [];
  const shapeIssues = validateFixtureShape(fixture);
  checks.push(shapeIssues.length === 0
    ? pass("fixture.shape", "Fixture has the required continuation compaction evidence shape.")
    : fail("fixture.shape", "Fixture shape is invalid.", shapeIssues));

  const observations = readObservations(fixture);
  checks.push(observations.length > 0
    ? pass("compaction-observations.present", "Fixture includes continuation compaction observations.")
    : fail("compaction-observations.present", "Fixture must include at least one continuation compaction observation.", ["continuationCompactionObservations must contain at least one row."]));

  const vocabularyIssues = validateVocabulary(observations);
  checks.push(vocabularyIssues.length === 0
    ? pass("vocabulary.bounded", "Statuses, reasons, and fallback states use bounded vocabulary.")
    : fail("vocabulary.bounded", "Continuation compaction vocabulary is invalid.", vocabularyIssues));

  const identityIssues = validateAttemptIdentity(observations);
  checks.push(identityIssues.length === 0
    ? pass("attempt-identity.valid", "Attempt identity is bounded and unique per delivery/attempt.")
    : fail("attempt-identity.valid", "Continuation compaction attempt identity is invalid.", identityIssues));

  const safetyIssues = validateDecisionSafety(observations);
  checks.push(safetyIssues.length === 0
    ? pass("decision-safety.valid", "Compacted rows have complete safety signals and fallback rows fail closed.")
    : fail("decision-safety.valid", "Continuation compaction safety rules are invalid.", safetyIssues));

  const totalsIssues = validateDeclaredTotals(fixture, observations);
  checks.push(totalsIssues.length === 0
    ? pass("totals.deterministic", "Declared continuation compaction totals match deterministic observation aggregation.")
    : fail("totals.deterministic", "Declared continuation compaction totals do not match deterministic aggregation.", totalsIssues));

  const redactionIssues = validateRedaction(fixture);
  checks.push(redactionIssues.length === 0
    ? pass("redaction.safe", "Continuation compaction fixture is text-free, fingerprint-free, and bounded.")
    : fail("redaction.safe", "Continuation compaction fixture contains raw text, raw fingerprints, or unbounded values.", redactionIssues));

  const failedChecks = checks.filter((check) => check.status === "fail");
  return {
    status: failedChecks.length === 0 ? "pass" : "fail",
    checks,
    totals: aggregateContinuationCompactionObservations(observations),
  };
}

export function aggregateContinuationCompactionObservations(observations: readonly ContinuationCompactionObservation[]): ContinuationCompactionSummary {
  const statusCounts = zeroStatusCounts();
  const reasonCounts = zeroReasonCounts();
  const fallbackStateCounts = zeroFallbackStateCounts();
  const deliveryIds: string[] = [];
  const attemptIds: string[] = [];
  const safetySignalNames: string[] = [];
  const budgetSignalNames: string[] = [];
  const cacheSignalNames: string[] = [];
  const missingSignalNames: string[] = [];
  let includedDeltaCount = 0;
  let reusedCheckpointCount = 0;
  let omittedScopeCount = 0;
  let remainingScopeCount = 0;

  for (const observation of observations) {
    if (isContinuationCompactionStatus(observation.status)) statusCounts[observation.status] += 1;
    if (isContinuationCompactionReason(observation.reason)) reasonCounts[observation.reason] += 1;
    if (isContinuationCompactionFallbackState(observation.fallbackState)) fallbackStateCounts[observation.fallbackState] += 1;
    if (isNonEmptyString(observation.deliveryId)) deliveryIds.push(observation.deliveryId);
    if (isNonEmptyString(observation.attemptId)) attemptIds.push(`${observation.deliveryId}\u0000${observation.attemptId}`);
    if (isFiniteNonNegativeInteger(observation.includedDeltaCount)) includedDeltaCount += observation.includedDeltaCount;
    if (isFiniteNonNegativeInteger(observation.reusedCheckpointCount)) reusedCheckpointCount += observation.reusedCheckpointCount;
    if (isFiniteNonNegativeInteger(observation.omittedScopeCount)) omittedScopeCount += observation.omittedScopeCount;
    if (isFiniteNonNegativeInteger(observation.remainingScopeCount)) remainingScopeCount += observation.remainingScopeCount;
    collectSignals(observation.safetySignalNames, safetySignalNames);
    collectSignals(observation.budgetSignalNames, budgetSignalNames);
    collectSignals(observation.cacheSignalNames, cacheSignalNames);
    collectSignals(observation.missingSignalNames, missingSignalNames);
  }

  return {
    observationCount: observations.length,
    deliveryCount: uniqueSorted(deliveryIds).length,
    attemptCount: uniqueSorted(attemptIds).length,
    statusCounts,
    reasonCounts,
    fallbackStateCounts,
    includedDeltaCount,
    reusedCheckpointCount,
    omittedScopeCount,
    remainingScopeCount,
    safetySignalNames: uniqueSorted(safetySignalNames),
    budgetSignalNames: uniqueSorted(budgetSignalNames),
    cacheSignalNames: uniqueSorted(cacheSignalNames),
    missingSignalNames: uniqueSorted(missingSignalNames),
  };
}

export function isContinuationCompactionStatus(value: unknown): value is ContinuationCompactionStatus {
  return typeof value === "string" && ALLOWED_STATUSES.has(value as ContinuationCompactionStatus);
}

export function isContinuationCompactionReason(value: unknown): value is ContinuationCompactionReason {
  return typeof value === "string" && ALLOWED_REASONS.has(value as ContinuationCompactionReason);
}

export function isContinuationCompactionFallbackState(value: unknown): value is ContinuationCompactionFallbackState {
  return typeof value === "string" && ALLOWED_FALLBACK_STATES.has(value as ContinuationCompactionFallbackState);
}

function validateFixtureShape(fixture: unknown): string[] {
  if (!isPlainObject(fixture)) return ["Fixture root must be an object."];
  const issues: string[] = [];
  if (!Array.isArray(fixture.continuationCompactionObservations)) issues.push("continuationCompactionObservations must be an array.");
  if (!isPlainObject(fixture.continuationCompactionSummary)) issues.push("continuationCompactionSummary must be an object.");
  return issues;
}

function validateVocabulary(observations: readonly ContinuationCompactionObservation[]): string[] {
  const issues: string[] = [];
  observations.forEach((observation, index) => {
    const prefix = `continuationCompactionObservations[${index}]`;
    if (!isContinuationCompactionStatus(observation.status)) issues.push(`${prefix}.status is not allowed.`);
    if (!isContinuationCompactionReason(observation.reason)) issues.push(`${prefix}.reason is not allowed.`);
    if (!isContinuationCompactionFallbackState(observation.fallbackState)) issues.push(`${prefix}.fallbackState is not allowed.`);
  });
  return issues;
}

function validateAttemptIdentity(observations: readonly ContinuationCompactionObservation[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  observations.forEach((observation, index) => {
    const prefix = `continuationCompactionObservations[${index}]`;
    if (!isBoundedIdentifier(observation.caseId)) issues.push(`${prefix}.caseId must be a bounded identifier.`);
    if (!isBoundedIdentifier(observation.deliveryId)) issues.push(`${prefix}.deliveryId must be a bounded identifier.`);
    if (!isBoundedIdentifier(observation.repo)) issues.push(`${prefix}.repo must be a bounded identifier.`);
    if (!isBoundedIdentifier(observation.attemptId)) issues.push(`${prefix}.attemptId must be a bounded identifier.`);
    if (observation.priorAttemptId !== undefined && !isBoundedIdentifier(observation.priorAttemptId)) issues.push(`${prefix}.priorAttemptId must be a bounded identifier when present.`);
    if (observation.attemptOrdinal !== undefined && !isFiniteNonNegativeInteger(observation.attemptOrdinal)) issues.push(`${prefix}.attemptOrdinal must be a non-negative integer when present.`);
    if (isBoundedIdentifier(observation.deliveryId) && isBoundedIdentifier(observation.attemptId)) {
      const key = `${observation.deliveryId}\u0000${observation.attemptId}`;
      if (seen.has(key)) issues.push(`${prefix} duplicates deliveryId/attemptId.`);
      seen.add(key);
    }
  });
  return issues;
}

function validateDecisionSafety(observations: readonly ContinuationCompactionObservation[]): string[] {
  const issues: string[] = [];
  observations.forEach((observation, index) => {
    const prefix = `continuationCompactionObservations[${index}]`;
    validateCount(observation.includedDeltaCount, `${prefix}.includedDeltaCount`, issues);
    validateCount(observation.reusedCheckpointCount, `${prefix}.reusedCheckpointCount`, issues);
    validateCount(observation.omittedScopeCount, `${prefix}.omittedScopeCount`, issues);
    validateCount(observation.remainingScopeCount, `${prefix}.remainingScopeCount`, issues);
    validateSignalNames(observation.safetySignalNames, `${prefix}.safetySignalNames`, issues);
    validateSignalNames(observation.budgetSignalNames, `${prefix}.budgetSignalNames`, issues);
    validateSignalNames(observation.cacheSignalNames, `${prefix}.cacheSignalNames`, issues);
    validateSignalNames(observation.missingSignalNames, `${prefix}.missingSignalNames`, issues);

    if (observation.status === "compacted") {
      if (observation.reason !== "safe-delta-reuse") issues.push(`${prefix} compacted status requires safe-delta-reuse reason.`);
      if (observation.fallbackState !== "none") issues.push(`${prefix} compacted status requires fallbackState none.`);
      if (!isBoundedIdentifier(observation.priorAttemptId)) issues.push(`${prefix} compacted status requires priorAttemptId.`);
      if (observation.includedDeltaCount <= 0) issues.push(`${prefix} compacted status requires at least one included delta.`);
      if (observation.reusedCheckpointCount <= 0) issues.push(`${prefix} compacted status requires at least one reused checkpoint.`);
      requireNonEmptySignals(observation.safetySignalNames, `${prefix}.safetySignalNames`, issues);
      requireNonEmptySignals(observation.budgetSignalNames, `${prefix}.budgetSignalNames`, issues);
      requireNonEmptySignals(observation.cacheSignalNames, `${prefix}.cacheSignalNames`, issues);
      return;
    }

    if (observation.status === "fallback") {
      if (!["missing-checkpoint", "missing-budget-signal", "unsafe-cache-state", "malformed-prior-state"].includes(observation.reason)) {
        issues.push(`${prefix} fallback status requires a fail-closed fallback reason.`);
      }
      if (observation.fallbackState !== "fuller-context") issues.push(`${prefix} fallback status requires fallbackState fuller-context.`);
      if (observation.reusedCheckpointCount !== 0) issues.push(`${prefix} fallback status cannot reuse checkpoints.`);
      if (observation.reason.startsWith("missing-") && (!Array.isArray(observation.missingSignalNames) || observation.missingSignalNames.length === 0)) {
        issues.push(`${prefix} missing-* fallback reason requires missingSignalNames.`);
      }
      return;
    }

    if (observation.status === "degraded") {
      if (observation.reason !== "degraded-cache-signal") issues.push(`${prefix} degraded status requires degraded-cache-signal reason.`);
      if (observation.fallbackState !== "partial-context") issues.push(`${prefix} degraded status requires fallbackState partial-context.`);
      if (!Array.isArray(observation.cacheSignalNames) || observation.cacheSignalNames.length === 0) issues.push(`${prefix} degraded status requires cacheSignalNames.`);
      return;
    }

    if (observation.status === "bypass") {
      if (observation.reason !== "no-remaining-scope") issues.push(`${prefix} bypass status requires no-remaining-scope reason.`);
      if (observation.fallbackState !== "none") issues.push(`${prefix} bypass status requires fallbackState none.`);
      if (observation.includedDeltaCount !== 0 || observation.reusedCheckpointCount !== 0 || observation.omittedScopeCount !== 0 || observation.remainingScopeCount !== 0) {
        issues.push(`${prefix} bypass status requires zero continuation counts.`);
      }
    }
  });
  return issues;
}

function validateCount(value: unknown, path: string, issues: string[]): void {
  if (!isFiniteNonNegativeInteger(value)) issues.push(`${path} must be a non-negative integer.`);
}

function validateSignalNames(values: unknown, path: string, issues: string[]): void {
  if (values === undefined) return;
  if (!Array.isArray(values)) {
    issues.push(`${path} must be an array when present.`);
    return;
  }
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (!isBoundedSignalName(value)) {
      issues.push(`${path}[${index}] must be a bounded signal name.`);
      return;
    }
    if (seen.has(value)) issues.push(`${path}[${index}] duplicates signal name within the row.`);
    seen.add(value);
  });
}

function requireNonEmptySignals(values: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(values) || values.length === 0) issues.push(`${path} must contain at least one bounded signal name.`);
}

function validateDeclaredTotals(fixture: unknown, observations: readonly ContinuationCompactionObservation[]): string[] {
  if (!isPlainObject(fixture) || !isPlainObject(fixture.continuationCompactionSummary)) {
    return ["continuationCompactionSummary is required to prove deterministic totals."];
  }
  const expected = aggregateContinuationCompactionObservations(observations);
  const actual = fixture.continuationCompactionSummary;
  return compareSummary(actual, expected, "continuationCompactionSummary");
}

function compareSummary(actual: Record<string, unknown>, expected: ContinuationCompactionSummary, path: string): string[] {
  const issues: string[] = [];
  compareNumber(actual, expected, "observationCount", path, issues);
  compareNumber(actual, expected, "deliveryCount", path, issues);
  compareNumber(actual, expected, "attemptCount", path, issues);
  compareNumber(actual, expected, "includedDeltaCount", path, issues);
  compareNumber(actual, expected, "reusedCheckpointCount", path, issues);
  compareNumber(actual, expected, "omittedScopeCount", path, issues);
  compareNumber(actual, expected, "remainingScopeCount", path, issues);
  compareNumberMap(actual.statusCounts, expected.statusCounts, `${path}.statusCounts`, issues);
  compareNumberMap(actual.reasonCounts, expected.reasonCounts, `${path}.reasonCounts`, issues);
  compareNumberMap(actual.fallbackStateCounts, expected.fallbackStateCounts, `${path}.fallbackStateCounts`, issues);
  compareStringArray(actual, expected, "safetySignalNames", path, issues);
  compareStringArray(actual, expected, "budgetSignalNames", path, issues);
  compareStringArray(actual, expected, "cacheSignalNames", path, issues);
  compareStringArray(actual, expected, "missingSignalNames", path, issues);
  return issues;
}

function compareNumber(actual: Record<string, unknown>, expected: ContinuationCompactionSummary, key: keyof Pick<ContinuationCompactionSummary, "observationCount" | "deliveryCount" | "attemptCount" | "includedDeltaCount" | "reusedCheckpointCount" | "omittedScopeCount" | "remainingScopeCount">, path: string, issues: string[]): void {
  const value = actual[key];
  if (!isFiniteNonNegativeInteger(value)) {
    issues.push(`${path}.${key} must be a non-negative integer.`);
    return;
  }
  if (value !== expected[key]) issues.push(`${path}.${key} expected ${expected[key]} but found ${value}.`);
}

function compareStringArray(actual: Record<string, unknown>, expected: ContinuationCompactionSummary, key: keyof Pick<ContinuationCompactionSummary, "safetySignalNames" | "budgetSignalNames" | "cacheSignalNames" | "missingSignalNames">, path: string, issues: string[]): void {
  const value = actual[key];
  if (!Array.isArray(value) || !value.every(isBoundedSignalName)) {
    issues.push(`${path}.${key} must be an array of bounded signal names.`);
    return;
  }
  const normalized = uniqueSorted(value);
  const expectedValue = [...expected[key]];
  if (JSON.stringify(normalized) !== JSON.stringify(expectedValue)) issues.push(`${path}.${key} expected ${JSON.stringify(expectedValue)} but found ${JSON.stringify(normalized)}.`);
}

function compareNumberMap(actual: unknown, expected: Record<string, number>, path: string, issues: string[]): void {
  if (!isPlainObject(actual)) {
    issues.push(`${path} must be an object.`);
    return;
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    const value = actual[key];
    if (!isFiniteNonNegativeInteger(value)) {
      issues.push(`${path}.${key} must be a non-negative integer.`);
      continue;
    }
    if (value !== expectedValue) issues.push(`${path}.${key} expected ${expectedValue} but found ${value}.`);
  }
}

function validateRedaction(value: unknown, path = "fixture"): string[] {
  const issues: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => issues.push(...validateRedaction(item, `${path}[${index}]`)));
    return issues;
  }
  if (!isPlainObject(value)) {
    if (typeof value === "string") {
      if (value.length > MAX_BOUNDED_STRING_LENGTH) issues.push(`${path} string value exceeds bounded length.`);
      if (SECRET_LIKE_VALUE.test(value)) issues.push(`${path} contains a secret-like value.`);
    }
    return issues;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_RAW_TEXT_KEYS.test(key)) {
      issues.push(`${childPath} is a forbidden raw-text field.`);
      continue;
    }
    if (FORBIDDEN_RAW_FINGERPRINT_KEYS.test(key)) {
      issues.push(`${childPath} is a forbidden raw-fingerprint field.`);
      continue;
    }
    issues.push(...validateRedaction(child, childPath));
  }
  return issues;
}

function readObservations(fixture: unknown): ContinuationCompactionObservation[] {
  if (!isPlainObject(fixture) || !Array.isArray(fixture.continuationCompactionObservations)) return [];
  return fixture.continuationCompactionObservations.filter(isPlainObject).map((row) => ({
    caseId: typeof row.caseId === "string" ? row.caseId : "",
    deliveryId: typeof row.deliveryId === "string" ? row.deliveryId : "",
    repo: typeof row.repo === "string" ? row.repo : "",
    attemptId: typeof row.attemptId === "string" ? row.attemptId : "",
    priorAttemptId: typeof row.priorAttemptId === "string" ? row.priorAttemptId : undefined,
    attemptOrdinal: typeof row.attemptOrdinal === "number" ? row.attemptOrdinal : undefined,
    status: row.status as ContinuationCompactionStatus,
    reason: row.reason as ContinuationCompactionReason,
    fallbackState: row.fallbackState as ContinuationCompactionFallbackState,
    includedDeltaCount: typeof row.includedDeltaCount === "number" ? row.includedDeltaCount : -1,
    reusedCheckpointCount: typeof row.reusedCheckpointCount === "number" ? row.reusedCheckpointCount : -1,
    omittedScopeCount: typeof row.omittedScopeCount === "number" ? row.omittedScopeCount : -1,
    remainingScopeCount: typeof row.remainingScopeCount === "number" ? row.remainingScopeCount : -1,
    budgetSignalNames: Array.isArray(row.budgetSignalNames) ? row.budgetSignalNames.filter((value): value is string => typeof value === "string") : undefined,
    cacheSignalNames: Array.isArray(row.cacheSignalNames) ? row.cacheSignalNames.filter((value): value is string => typeof value === "string") : undefined,
    missingSignalNames: Array.isArray(row.missingSignalNames) ? row.missingSignalNames.filter((value): value is string => typeof value === "string") : undefined,
    safetySignalNames: Array.isArray(row.safetySignalNames) ? row.safetySignalNames.filter((value): value is string => typeof value === "string") : undefined,
  }));
}

function zeroStatusCounts(): Record<ContinuationCompactionStatus, number> {
  return Object.fromEntries(CONTINUATION_COMPACTION_STATUSES.map((status) => [status, 0])) as Record<ContinuationCompactionStatus, number>;
}

function zeroReasonCounts(): Record<ContinuationCompactionReason, number> {
  return Object.fromEntries(CONTINUATION_COMPACTION_REASONS.map((reason) => [reason, 0])) as Record<ContinuationCompactionReason, number>;
}

function zeroFallbackStateCounts(): Record<ContinuationCompactionFallbackState, number> {
  return Object.fromEntries(CONTINUATION_COMPACTION_FALLBACK_STATES.map((state) => [state, 0])) as Record<ContinuationCompactionFallbackState, number>;
}

function collectSignals(values: readonly string[] | undefined, target: string[]): void {
  if (Array.isArray(values)) target.push(...values.filter(isBoundedSignalName));
}

function pass(id: ContinuationCompactionCheckId, message: string): ContinuationCompactionCheck {
  return { id, status: "pass", message, issues: [] };
}

function fail(id: ContinuationCompactionCheckId, message: string, issues: readonly string[]): ContinuationCompactionCheck {
  return { id, status: "fail", message, issues: boundIssues(issues) };
}

function boundIssues(issues: readonly string[]): string[] {
  return issues.slice(0, MAX_ISSUES).map((issue) => issue.length > 220 ? `${issue.slice(0, 217)}...` : issue);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && BOUNDED_IDENTIFIER.test(value);
}

function isBoundedSignalName(value: unknown): value is string {
  return typeof value === "string" && BOUNDED_SIGNAL_NAME.test(value);
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
