export const REVIEW_CACHE_TELEMETRY_SURFACES = [
  "review-derived-prompt",
  "retrieval-query-embedding",
] as const;

export const REVIEW_CACHE_TELEMETRY_STATUSES = [
  "hit",
  "miss",
  "degraded",
  "bypass",
] as const;

export const REVIEW_CACHE_TELEMETRY_REASONS = [
  "safe-reuse",
  "cache-miss",
  "bookkeeping-failure",
  "incomplete-fingerprint",
  "expired-stale-entry",
  "disabled-cache",
  "unavailable-retrieval",
] as const;

export const REVIEW_CACHE_TELEMETRY_CHECK_IDS = [
  "fixture.shape",
  "cache-observations.present",
  "vocabulary.bounded",
  "observation-identity.unique",
  "reuse-safety.valid",
  "totals.deterministic",
  "redaction.safe",
] as const;

export type ReviewCacheTelemetrySurface = typeof REVIEW_CACHE_TELEMETRY_SURFACES[number];
export type ReviewCacheTelemetryStatus = typeof REVIEW_CACHE_TELEMETRY_STATUSES[number];
export type ReviewCacheTelemetryReason = typeof REVIEW_CACHE_TELEMETRY_REASONS[number];
export type ReviewCacheTelemetryCheckId = typeof REVIEW_CACHE_TELEMETRY_CHECK_IDS[number];
export type ReviewCacheTelemetryCheckStatus = "pass" | "fail";

export type ReviewCacheTelemetryObservation = {
  readonly cacheSurface: ReviewCacheTelemetrySurface;
  readonly status: ReviewCacheTelemetryStatus;
  readonly reason?: ReviewCacheTelemetryReason;
  readonly deliveryId: string;
  readonly repo: string;
  readonly prNumber?: number;
  readonly attemptOrdinal?: number;
  readonly fingerprintVersion?: string;
  readonly safetySignalNames?: readonly string[];
  readonly missingSignalNames?: readonly string[];
  readonly invalidationSignalNames?: readonly string[];
  readonly bookkeepingErrorCount?: number;
};

export type ReviewCacheTelemetrySummary = {
  readonly observationCount: number;
  readonly deliveryCount: number;
  readonly surfaceCounts: Record<ReviewCacheTelemetrySurface, number>;
  readonly statusCounts: Record<ReviewCacheTelemetryStatus, number>;
  readonly reasonCounts: Record<ReviewCacheTelemetryReason, number>;
  readonly surfaceStatusCounts: Record<ReviewCacheTelemetrySurface, Record<ReviewCacheTelemetryStatus, number>>;
  readonly surfaceReasonCounts: Record<ReviewCacheTelemetrySurface, Record<ReviewCacheTelemetryReason, number>>;
  readonly bookkeepingErrorCount: number;
  readonly missingSignalNames: readonly string[];
  readonly invalidationSignalNames: readonly string[];
};

export type ReviewCacheTelemetryFixture = {
  readonly generatedAt?: string;
  readonly cacheTelemetryObservations: readonly ReviewCacheTelemetryObservation[];
  readonly cacheTelemetrySummary: ReviewCacheTelemetrySummary;
};

export type ReviewCacheTelemetryCheck = {
  readonly id: ReviewCacheTelemetryCheckId;
  readonly status: ReviewCacheTelemetryCheckStatus;
  readonly message: string;
  readonly issues: readonly string[];
};

export type ReviewCacheTelemetryEvaluation = {
  readonly status: ReviewCacheTelemetryCheckStatus;
  readonly checks: readonly ReviewCacheTelemetryCheck[];
  readonly totals: ReviewCacheTelemetrySummary;
};

const ALLOWED_SURFACES = new Set<ReviewCacheTelemetrySurface>(REVIEW_CACHE_TELEMETRY_SURFACES);
const ALLOWED_STATUSES = new Set<ReviewCacheTelemetryStatus>(REVIEW_CACHE_TELEMETRY_STATUSES);
const ALLOWED_REASONS = new Set<ReviewCacheTelemetryReason>(REVIEW_CACHE_TELEMETRY_REASONS);
const MAX_ISSUES = 20;
const MAX_BOUNDED_STRING_LENGTH = 160;
const BOUNDED_SIGNAL_NAME = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const FORBIDDEN_RAW_TEXT_KEYS = /(^|_)(rawPrompt|promptText|prompt|diff|patch|comment|commentBody|body|candidate|candidatePayload|modelOutput|completion|content|text|retrievalText|retrievalChunk|retrievalChunks|chunkText)$/i;
const FORBIDDEN_RAW_FINGERPRINT_KEYS = /(^|_)(fingerprint|rawFingerprint|fingerprintHash|promptHash|diffHash|cacheKey|cacheKeyHash|embedding|embeddingVector|vector)$/i;
const SECRET_LIKE_VALUE = /(ghp_|github_pat_|sk-[a-z0-9]|azure[_-]?client[_-]?secret|password\s*=|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

export function evaluateReviewCacheTelemetryFixture(fixture: unknown): ReviewCacheTelemetryEvaluation {
  const checks: ReviewCacheTelemetryCheck[] = [];
  const shapeIssues = validateFixtureShape(fixture);
  checks.push(shapeIssues.length === 0
    ? pass("fixture.shape", "Fixture has the required cache telemetry evidence shape.")
    : fail("fixture.shape", "Fixture shape is invalid.", shapeIssues));

  const observations = readObservations(fixture);
  checks.push(observations.length > 0
    ? pass("cache-observations.present", "Fixture includes cache telemetry observations.")
    : fail("cache-observations.present", "Fixture must include at least one cache telemetry observation.", ["cacheTelemetryObservations must contain at least one row."]));

  const vocabularyIssues = validateVocabulary(observations);
  checks.push(vocabularyIssues.length === 0
    ? pass("vocabulary.bounded", "Cache surfaces, statuses, and reasons use bounded vocabulary.")
    : fail("vocabulary.bounded", "Cache telemetry vocabulary is invalid.", vocabularyIssues));

  const identityIssues = validateObservationIdentity(observations);
  checks.push(identityIssues.length === 0
    ? pass("observation-identity.unique", "Delivery/surface rows are unique or attempt-ordinal disambiguated.")
    : fail("observation-identity.unique", "Cache telemetry observation identity is ambiguous.", identityIssues));

  const safetyIssues = validateReuseSafety(observations);
  checks.push(safetyIssues.length === 0
    ? pass("reuse-safety.valid", "Hit rows include safety fingerprint metadata and non-hit rows include bounded reasons.")
    : fail("reuse-safety.valid", "Cache telemetry reuse safety metadata is invalid.", safetyIssues));

  const totalsIssues = validateDeclaredTotals(fixture, observations);
  checks.push(totalsIssues.length === 0
    ? pass("totals.deterministic", "Declared cache telemetry totals match deterministic observation aggregation.")
    : fail("totals.deterministic", "Declared cache telemetry totals do not match deterministic aggregation.", totalsIssues));

  const redactionIssues = validateRedaction(fixture);
  checks.push(redactionIssues.length === 0
    ? pass("redaction.safe", "Cache telemetry fixture is text-free, fingerprint-free, and bounded.")
    : fail("redaction.safe", "Cache telemetry fixture contains raw text, raw fingerprints, or unbounded values.", redactionIssues));

  const failedChecks = checks.filter((check) => check.status === "fail");
  return {
    status: failedChecks.length === 0 ? "pass" : "fail",
    checks,
    totals: aggregateReviewCacheTelemetryObservations(observations),
  };
}

export function aggregateReviewCacheTelemetryObservations(observations: readonly ReviewCacheTelemetryObservation[]): ReviewCacheTelemetrySummary {
  const surfaceCounts = zeroSurfaceCounts();
  const statusCounts = zeroStatusCounts();
  const reasonCounts = zeroReasonCounts();
  const surfaceStatusCounts = zeroSurfaceStatusCounts();
  const surfaceReasonCounts = zeroSurfaceReasonCounts();
  const deliveryIds: string[] = [];
  const missingSignalNames: string[] = [];
  const invalidationSignalNames: string[] = [];
  let bookkeepingErrorCount = 0;

  for (const observation of observations) {
    if (isReviewCacheTelemetrySurface(observation.cacheSurface)) {
      surfaceCounts[observation.cacheSurface] += 1;
      if (isReviewCacheTelemetryStatus(observation.status)) {
        surfaceStatusCounts[observation.cacheSurface][observation.status] += 1;
      }
      if (isReviewCacheTelemetryReason(observation.reason)) {
        surfaceReasonCounts[observation.cacheSurface][observation.reason] += 1;
      }
    }
    if (isReviewCacheTelemetryStatus(observation.status)) {
      statusCounts[observation.status] += 1;
    }
    if (isReviewCacheTelemetryReason(observation.reason)) {
      reasonCounts[observation.reason] += 1;
    }
    if (isNonEmptyString(observation.deliveryId)) {
      deliveryIds.push(observation.deliveryId);
    }
    if (Array.isArray(observation.missingSignalNames)) {
      missingSignalNames.push(...observation.missingSignalNames.filter(isBoundedSignalName));
    }
    if (Array.isArray(observation.invalidationSignalNames)) {
      invalidationSignalNames.push(...observation.invalidationSignalNames.filter(isBoundedSignalName));
    }
    if (isFiniteNonNegativeInteger(observation.bookkeepingErrorCount)) {
      bookkeepingErrorCount += observation.bookkeepingErrorCount;
    }
  }

  return {
    observationCount: observations.length,
    deliveryCount: uniqueSorted(deliveryIds).length,
    surfaceCounts,
    statusCounts,
    reasonCounts,
    surfaceStatusCounts,
    surfaceReasonCounts,
    bookkeepingErrorCount,
    missingSignalNames: uniqueSorted(missingSignalNames),
    invalidationSignalNames: uniqueSorted(invalidationSignalNames),
  };
}

export function isReviewCacheTelemetrySurface(value: unknown): value is ReviewCacheTelemetrySurface {
  return typeof value === "string" && ALLOWED_SURFACES.has(value as ReviewCacheTelemetrySurface);
}

export function isReviewCacheTelemetryStatus(value: unknown): value is ReviewCacheTelemetryStatus {
  return typeof value === "string" && ALLOWED_STATUSES.has(value as ReviewCacheTelemetryStatus);
}

export function isReviewCacheTelemetryReason(value: unknown): value is ReviewCacheTelemetryReason {
  return typeof value === "string" && ALLOWED_REASONS.has(value as ReviewCacheTelemetryReason);
}

function validateFixtureShape(fixture: unknown): string[] {
  if (!isPlainObject(fixture)) {
    return ["Fixture root must be an object."];
  }
  const issues: string[] = [];
  if (!Array.isArray(fixture.cacheTelemetryObservations)) {
    issues.push("cacheTelemetryObservations must be an array.");
  }
  if (!isPlainObject(fixture.cacheTelemetrySummary)) {
    issues.push("cacheTelemetrySummary must be an object.");
  }
  return issues;
}

function validateVocabulary(observations: readonly ReviewCacheTelemetryObservation[]): string[] {
  const issues: string[] = [];
  observations.forEach((observation, index) => {
    const prefix = `cacheTelemetryObservations[${index}]`;
    if (!isReviewCacheTelemetrySurface(observation.cacheSurface)) issues.push(`${prefix}.cacheSurface is not allowed.`);
    if (!isReviewCacheTelemetryStatus(observation.status)) issues.push(`${prefix}.status is not allowed.`);
    if (observation.reason !== undefined && !isReviewCacheTelemetryReason(observation.reason)) issues.push(`${prefix}.reason is not allowed.`);
  });
  return issues;
}

function validateObservationIdentity(observations: readonly ReviewCacheTelemetryObservation[]): string[] {
  const issues: string[] = [];
  const groups = new Map<string, Array<{ row: ReviewCacheTelemetryObservation; index: number }>>();
  observations.forEach((observation, index) => {
    const prefix = `cacheTelemetryObservations[${index}]`;
    if (!isNonEmptyString(observation.deliveryId)) issues.push(`${prefix} is missing deliveryId.`);
    if (!isNonEmptyString(observation.repo)) issues.push(`${prefix} is missing repo.`);
    if (observation.prNumber !== undefined && !isFiniteNonNegativeInteger(observation.prNumber)) issues.push(`${prefix}.prNumber must be a non-negative integer when present.`);
    if (observation.attemptOrdinal !== undefined && !isFiniteNonNegativeInteger(observation.attemptOrdinal)) issues.push(`${prefix}.attemptOrdinal must be a non-negative integer when present.`);
    if (isNonEmptyString(observation.deliveryId) && isReviewCacheTelemetrySurface(observation.cacheSurface)) {
      const key = `${observation.deliveryId}\u0000${observation.cacheSurface}`;
      const group = groups.get(key) ?? [];
      group.push({ row: observation, index });
      groups.set(key, group);
    }
  });

  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const ordinals = new Set<number>();
    for (const entry of group) {
      const prefix = `cacheTelemetryObservations[${entry.index}]`;
      if (!isFiniteNonNegativeInteger(entry.row.attemptOrdinal)) {
        issues.push(`${prefix} duplicates deliveryId/cacheSurface without attemptOrdinal.`);
        continue;
      }
      if (ordinals.has(entry.row.attemptOrdinal)) {
        issues.push(`${prefix} duplicates deliveryId/cacheSurface/attemptOrdinal.`);
      }
      ordinals.add(entry.row.attemptOrdinal);
    }
  }
  return issues;
}

function validateReuseSafety(observations: readonly ReviewCacheTelemetryObservation[]): string[] {
  const issues: string[] = [];
  observations.forEach((observation, index) => {
    const prefix = `cacheTelemetryObservations[${index}]`;
    if (!isFiniteNonNegativeInteger(observation.bookkeepingErrorCount ?? 0)) issues.push(`${prefix}.bookkeepingErrorCount must be a non-negative integer when present.`);
    validateSignalNames(observation.safetySignalNames, `${prefix}.safetySignalNames`, issues);
    validateSignalNames(observation.missingSignalNames, `${prefix}.missingSignalNames`, issues);
    validateSignalNames(observation.invalidationSignalNames, `${prefix}.invalidationSignalNames`, issues);

    if (observation.status === "hit") {
      if (observation.reason !== undefined && observation.reason !== "safe-reuse") issues.push(`${prefix} hit rows may only use safe-reuse reason.`);
      if (!isNonEmptyString(observation.fingerprintVersion)) issues.push(`${prefix} hit row is missing fingerprintVersion.`);
      if (!Array.isArray(observation.safetySignalNames) || observation.safetySignalNames.length === 0) issues.push(`${prefix} hit row is missing safetySignalNames.`);
      return;
    }

    if (observation.status === "bypass" || observation.status === "degraded") {
      if (!isReviewCacheTelemetryReason(observation.reason)) issues.push(`${prefix} ${observation.status} row is missing a bounded reason.`);
    }
    if (observation.status === "miss" && observation.reason !== undefined && observation.reason !== "cache-miss" && observation.reason !== "expired-stale-entry") {
      issues.push(`${prefix} miss row reason must be cache-miss or expired-stale-entry when present.`);
    }
    if (observation.reason === "incomplete-fingerprint" && (!Array.isArray(observation.missingSignalNames) || observation.missingSignalNames.length === 0)) {
      issues.push(`${prefix} incomplete-fingerprint reason requires bounded missingSignalNames.`);
    }
    if (observation.reason === "expired-stale-entry" && (!Array.isArray(observation.invalidationSignalNames) || observation.invalidationSignalNames.length === 0)) {
      issues.push(`${prefix} expired-stale-entry reason requires bounded invalidationSignalNames.`);
    }
    if (observation.reason === "bookkeeping-failure" && !(isFiniteNonNegativeInteger(observation.bookkeepingErrorCount) && observation.bookkeepingErrorCount > 0)) {
      issues.push(`${prefix} bookkeeping-failure reason requires positive bookkeepingErrorCount.`);
    }
  });
  return issues;
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

function validateDeclaredTotals(fixture: unknown, observations: readonly ReviewCacheTelemetryObservation[]): string[] {
  if (!isPlainObject(fixture) || !isPlainObject(fixture.cacheTelemetrySummary)) {
    return ["cacheTelemetrySummary is required to prove deterministic totals."];
  }
  const expected = aggregateReviewCacheTelemetryObservations(observations);
  const actual = fixture.cacheTelemetrySummary;
  return compareSummary(actual, expected, "cacheTelemetrySummary");
}

function compareSummary(actual: Record<string, unknown>, expected: ReviewCacheTelemetrySummary, path: string): string[] {
  const issues: string[] = [];
  compareNumber(actual, expected, "observationCount", path, issues);
  compareNumber(actual, expected, "deliveryCount", path, issues);
  compareNumber(actual, expected, "bookkeepingErrorCount", path, issues);
  compareStringArray(actual, expected, "missingSignalNames", path, issues);
  compareStringArray(actual, expected, "invalidationSignalNames", path, issues);
  compareNumberMap(actual.surfaceCounts, expected.surfaceCounts, `${path}.surfaceCounts`, issues);
  compareNumberMap(actual.statusCounts, expected.statusCounts, `${path}.statusCounts`, issues);
  compareNumberMap(actual.reasonCounts, expected.reasonCounts, `${path}.reasonCounts`, issues);
  compareNestedNumberMap(actual.surfaceStatusCounts, expected.surfaceStatusCounts, `${path}.surfaceStatusCounts`, issues);
  compareNestedNumberMap(actual.surfaceReasonCounts, expected.surfaceReasonCounts, `${path}.surfaceReasonCounts`, issues);
  return issues;
}

function compareNumber(actual: Record<string, unknown>, expected: ReviewCacheTelemetrySummary, key: keyof Pick<ReviewCacheTelemetrySummary, "observationCount" | "deliveryCount" | "bookkeepingErrorCount">, path: string, issues: string[]): void {
  const value = actual[key];
  if (!isFiniteNonNegativeInteger(value)) {
    issues.push(`${path}.${key} must be a non-negative integer.`);
    return;
  }
  if (value !== expected[key]) issues.push(`${path}.${key} expected ${expected[key]} but found ${value}.`);
}

function compareStringArray(actual: Record<string, unknown>, expected: ReviewCacheTelemetrySummary, key: keyof Pick<ReviewCacheTelemetrySummary, "missingSignalNames" | "invalidationSignalNames">, path: string, issues: string[]): void {
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

function compareNestedNumberMap(actual: unknown, expected: Record<string, Record<string, number>>, path: string, issues: string[]): void {
  if (!isPlainObject(actual)) {
    issues.push(`${path} must be an object.`);
    return;
  }
  for (const [outerKey, expectedInner] of Object.entries(expected)) {
    compareNumberMap(actual[outerKey], expectedInner, `${path}.${outerKey}`, issues);
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

function readObservations(fixture: unknown): ReviewCacheTelemetryObservation[] {
  if (!isPlainObject(fixture) || !Array.isArray(fixture.cacheTelemetryObservations)) return [];
  return fixture.cacheTelemetryObservations.filter(isPlainObject).map((row) => ({
    cacheSurface: row.cacheSurface as ReviewCacheTelemetrySurface,
    status: row.status as ReviewCacheTelemetryStatus,
    reason: row.reason as ReviewCacheTelemetryReason | undefined,
    deliveryId: typeof row.deliveryId === "string" ? row.deliveryId : "",
    repo: typeof row.repo === "string" ? row.repo : "",
    prNumber: typeof row.prNumber === "number" ? row.prNumber : undefined,
    attemptOrdinal: typeof row.attemptOrdinal === "number" ? row.attemptOrdinal : undefined,
    fingerprintVersion: typeof row.fingerprintVersion === "string" ? row.fingerprintVersion : undefined,
    safetySignalNames: Array.isArray(row.safetySignalNames) ? row.safetySignalNames.filter((value): value is string => typeof value === "string") : undefined,
    missingSignalNames: Array.isArray(row.missingSignalNames) ? row.missingSignalNames.filter((value): value is string => typeof value === "string") : undefined,
    invalidationSignalNames: Array.isArray(row.invalidationSignalNames) ? row.invalidationSignalNames.filter((value): value is string => typeof value === "string") : undefined,
    bookkeepingErrorCount: typeof row.bookkeepingErrorCount === "number" ? row.bookkeepingErrorCount : undefined,
  }));
}

function zeroSurfaceCounts(): Record<ReviewCacheTelemetrySurface, number> {
  return Object.fromEntries(REVIEW_CACHE_TELEMETRY_SURFACES.map((surface) => [surface, 0])) as Record<ReviewCacheTelemetrySurface, number>;
}

function zeroStatusCounts(): Record<ReviewCacheTelemetryStatus, number> {
  return Object.fromEntries(REVIEW_CACHE_TELEMETRY_STATUSES.map((status) => [status, 0])) as Record<ReviewCacheTelemetryStatus, number>;
}

function zeroReasonCounts(): Record<ReviewCacheTelemetryReason, number> {
  return Object.fromEntries(REVIEW_CACHE_TELEMETRY_REASONS.map((reason) => [reason, 0])) as Record<ReviewCacheTelemetryReason, number>;
}

function zeroSurfaceStatusCounts(): Record<ReviewCacheTelemetrySurface, Record<ReviewCacheTelemetryStatus, number>> {
  return Object.fromEntries(REVIEW_CACHE_TELEMETRY_SURFACES.map((surface) => [surface, zeroStatusCounts()])) as Record<ReviewCacheTelemetrySurface, Record<ReviewCacheTelemetryStatus, number>>;
}

function zeroSurfaceReasonCounts(): Record<ReviewCacheTelemetrySurface, Record<ReviewCacheTelemetryReason, number>> {
  return Object.fromEntries(REVIEW_CACHE_TELEMETRY_SURFACES.map((surface) => [surface, zeroReasonCounts()])) as Record<ReviewCacheTelemetrySurface, Record<ReviewCacheTelemetryReason, number>>;
}

function pass(id: ReviewCacheTelemetryCheckId, message: string): ReviewCacheTelemetryCheck {
  return { id, status: "pass", message, issues: [] };
}

function fail(id: ReviewCacheTelemetryCheckId, message: string, issues: readonly string[]): ReviewCacheTelemetryCheck {
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

function isBoundedSignalName(value: unknown): value is string {
  return typeof value === "string" && BOUNDED_SIGNAL_NAME.test(value);
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
