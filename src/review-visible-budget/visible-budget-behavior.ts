import {
  CONTINUATION_COMPACTION_FALLBACK_STATES,
  CONTINUATION_COMPACTION_REASONS,
  CONTINUATION_COMPACTION_STATUSES,
  aggregateContinuationCompactionObservations,
  type ContinuationCompactionObservation,
  type ContinuationCompactionReason,
  type ContinuationCompactionStatus,
  type ContinuationCompactionFallbackState,
} from "../review-continuation/continuation-compaction.ts";
import {
  REVIEW_CACHE_TELEMETRY_REASONS,
  REVIEW_CACHE_TELEMETRY_STATUSES,
  aggregateReviewCacheTelemetryObservations,
  type ReviewCacheTelemetryObservation,
  type ReviewCacheTelemetryReason,
  type ReviewCacheTelemetryStatus,
} from "../review-cache-telemetry/cache-telemetry.ts";

export const VISIBLE_BUDGET_SCENARIOS = [
  "happy-path",
  "scoped-review",
  "fallback-review",
] as const;

export const VISIBLE_BUDGET_STATUSES = [
  "complete",
  "scoped",
  "fallback",
] as const;

export const VISIBLE_BUDGET_REASONS = [
  "within-budget",
  "prompt-budget-limited",
  "continuation-compacted",
  "continuation-fallback",
  "cache-degraded",
] as const;

export const VISIBLE_BUDGET_CHECK_IDS = [
  "fixture.shape",
  "projection-cases.present",
  "scenario-coverage.present",
  "vocabulary.bounded",
  "projection-safety.valid",
  "totals.deterministic",
  "redaction.safe",
] as const;

export type VisibleBudgetScenario = typeof VISIBLE_BUDGET_SCENARIOS[number];
export type VisibleBudgetStatus = typeof VISIBLE_BUDGET_STATUSES[number];
export type VisibleBudgetReason = typeof VISIBLE_BUDGET_REASONS[number];
export type VisibleBudgetCheckId = typeof VISIBLE_BUDGET_CHECK_IDS[number];
export type VisibleBudgetCheckStatus = "pass" | "fail";

export type PromptBudgetEvidenceStatus = "included" | "trimmed" | "bypassed";
export type PromptBudgetEvidenceReason = "within-budget" | "section-over-budget" | "zero-budget";

export type PromptBudgetEvidenceSection = {
  readonly sectionName: string;
  readonly sectionPosition: number;
  readonly budgetChars: number;
  readonly budgetTokens: number;
  readonly includedChars: number;
  readonly includedTokens: number;
  readonly trimmedChars: number;
  readonly trimmedTokens: number;
  readonly budgetStatus: PromptBudgetEvidenceStatus;
  readonly budgetReason: PromptBudgetEvidenceReason;
};

export type PromptBudgetEvidenceObservation = {
  readonly caseId: string;
  readonly deliveryId: string;
  readonly repo: string;
  readonly taskType: string;
  readonly promptKind: string;
  readonly sections: readonly PromptBudgetEvidenceSection[];
};

export type VisiblePromptBudgetCounts = {
  readonly observationCount: number;
  readonly sectionCount: number;
  readonly statusCounts: Record<PromptBudgetEvidenceStatus, number>;
  readonly reasonCounts: Record<PromptBudgetEvidenceReason, number>;
  readonly totalBudgetTokens: number;
  readonly totalIncludedTokens: number;
  readonly totalTrimmedTokens: number;
};

export type VisibleCacheCounts = {
  readonly observationCount: number;
  readonly statusCounts: Record<ReviewCacheTelemetryStatus, number>;
  readonly reasonCounts: Record<ReviewCacheTelemetryReason, number>;
  readonly bookkeepingErrorCount: number;
  readonly missingSignalCount: number;
  readonly invalidationSignalCount: number;
};

export type VisibleContinuationCounts = {
  readonly observationCount: number;
  readonly statusCounts: Record<ContinuationCompactionStatus, number>;
  readonly reasonCounts: Record<ContinuationCompactionReason, number>;
  readonly fallbackStateCounts: Record<ContinuationCompactionFallbackState, number>;
  readonly includedDeltaCount: number;
  readonly reusedCheckpointCount: number;
  readonly omittedScopeCount: number;
  readonly remainingScopeCount: number;
  readonly safetySignalCount: number;
  readonly budgetSignalCount: number;
  readonly cacheSignalCount: number;
  readonly missingSignalCount: number;
};

export type VisibleBudgetProjection = {
  readonly scenario: VisibleBudgetScenario;
  readonly visibleStatus: VisibleBudgetStatus;
  readonly visibleReason: VisibleBudgetReason;
  readonly promptBudget: VisiblePromptBudgetCounts;
  readonly cache: VisibleCacheCounts;
  readonly continuation: VisibleContinuationCounts;
};

export type VisibleBudgetSummary = {
  readonly projectionCount: number;
  readonly scenarioCounts: Record<VisibleBudgetScenario, number>;
  readonly statusCounts: Record<VisibleBudgetStatus, number>;
  readonly reasonCounts: Record<VisibleBudgetReason, number>;
  readonly promptObservationCount: number;
  readonly promptSectionCount: number;
  readonly promptTrimmedSectionCount: number;
  readonly promptBypassedSectionCount: number;
  readonly promptTrimmedTokenCount: number;
  readonly cacheObservationCount: number;
  readonly cacheHitCount: number;
  readonly cacheMissCount: number;
  readonly cacheDegradedCount: number;
  readonly cacheBypassCount: number;
  readonly continuationObservationCount: number;
  readonly continuationCompactedCount: number;
  readonly continuationFallbackCount: number;
  readonly continuationDegradedCount: number;
  readonly continuationBypassCount: number;
};

export type VisibleBudgetFixture = {
  readonly generatedAt?: string;
  readonly visibleBudgetProjections: readonly VisibleBudgetProjection[];
  readonly visibleBudgetSummary: VisibleBudgetSummary;
};

export type VisibleBudgetCheck = {
  readonly id: VisibleBudgetCheckId;
  readonly status: VisibleBudgetCheckStatus;
  readonly message: string;
  readonly issues: readonly string[];
};

export type VisibleBudgetEvaluation = {
  readonly status: VisibleBudgetCheckStatus;
  readonly checks: readonly VisibleBudgetCheck[];
  readonly totals: VisibleBudgetSummary;
};

export type BuildVisibleBudgetProjectionOptions = {
  readonly scenario: VisibleBudgetScenario;
  readonly promptBudgetEvidence: readonly PromptBudgetEvidenceObservation[];
  readonly cacheTelemetryObservations: readonly ReviewCacheTelemetryObservation[];
  readonly continuationCompactionObservations: readonly ContinuationCompactionObservation[];
};

const PROMPT_BUDGET_STATUSES = ["included", "trimmed", "bypassed"] as const;
const PROMPT_BUDGET_REASONS = ["within-budget", "section-over-budget", "zero-budget"] as const;
const ALLOWED_SCENARIOS = new Set<VisibleBudgetScenario>(VISIBLE_BUDGET_SCENARIOS);
const ALLOWED_STATUSES = new Set<VisibleBudgetStatus>(VISIBLE_BUDGET_STATUSES);
const ALLOWED_REASONS = new Set<VisibleBudgetReason>(VISIBLE_BUDGET_REASONS);
const MAX_ISSUES = 20;
const MAX_BOUNDED_STRING_LENGTH = 160;
const FORBIDDEN_RAW_TEXT_KEYS = /(^|_)(rawPrompt|promptText|prompt|diff|diffHunk|hunk|patch|comment|commentBody|body|candidate|candidateText|candidatePayload|modelOutput|completion|content|text|includedText|trimmedText|sectionText|retrievalText|retrievalChunk|retrievalChunks|chunkText)$/i;
const FORBIDDEN_RAW_FINGERPRINT_KEYS = /(^|_)(fingerprint|rawFingerprint|fingerprintHash|promptHash|diffHash|cacheKey|cacheKeyHash|embedding|embeddingVector|vector)$/i;
const SECRET_LIKE_VALUE = /(ghp_|github_pat_|sk-[a-z0-9]|azure[_-]?client[_-]?secret|password\s*=|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

export function buildVisibleBudgetProjection(options: BuildVisibleBudgetProjectionOptions): VisibleBudgetProjection {
  const promptBudget = aggregatePromptBudgetEvidence(options.promptBudgetEvidence);
  const cache = aggregateCacheTelemetry(options.cacheTelemetryObservations);
  const continuation = aggregateContinuationCompaction(options.continuationCompactionObservations);
  const visibleReason = chooseVisibleReason(promptBudget, cache, continuation);

  return {
    scenario: options.scenario,
    visibleStatus: chooseVisibleStatus(visibleReason),
    visibleReason,
    promptBudget,
    cache,
    continuation,
  };
}

export function buildReviewDetailsBudgetLines(projection: VisibleBudgetProjection): string[] {
  return [
    `Budget behavior: ${projection.visibleStatus} (${projection.visibleReason}).`,
    `Prompt budget: ${projection.promptBudget.sectionCount} sections, ${projection.promptBudget.statusCounts.trimmed} trimmed, ${projection.promptBudget.statusCounts.bypassed} bypassed, ${projection.promptBudget.totalTrimmedTokens} trimmed tokens.`,
    `Cache behavior: ${projection.cache.observationCount} observations, ${projection.cache.statusCounts.hit} hits, ${projection.cache.statusCounts.miss} misses, ${projection.cache.statusCounts.degraded} degraded, ${projection.cache.statusCounts.bypass} bypassed.`,
    `Continuation behavior: ${projection.continuation.observationCount} observations, ${projection.continuation.statusCounts.compacted} compacted, ${projection.continuation.statusCounts.fallback} fallback, ${projection.continuation.statusCounts.degraded} degraded, ${projection.continuation.statusCounts.bypass} bypassed.`,
  ];
}

export function aggregateVisibleBudgetProjections(projections: readonly VisibleBudgetProjection[]): VisibleBudgetSummary {
  const scenarioCounts = zeroScenarioCounts();
  const statusCounts = zeroVisibleStatusCounts();
  const reasonCounts = zeroVisibleReasonCounts();
  let promptObservationCount = 0;
  let promptSectionCount = 0;
  let promptTrimmedSectionCount = 0;
  let promptBypassedSectionCount = 0;
  let promptTrimmedTokenCount = 0;
  let cacheObservationCount = 0;
  let cacheHitCount = 0;
  let cacheMissCount = 0;
  let cacheDegradedCount = 0;
  let cacheBypassCount = 0;
  let continuationObservationCount = 0;
  let continuationCompactedCount = 0;
  let continuationFallbackCount = 0;
  let continuationDegradedCount = 0;
  let continuationBypassCount = 0;

  for (const projection of projections) {
    if (isVisibleBudgetScenario(projection.scenario)) scenarioCounts[projection.scenario] += 1;
    if (isVisibleBudgetStatus(projection.visibleStatus)) statusCounts[projection.visibleStatus] += 1;
    if (isVisibleBudgetReason(projection.visibleReason)) reasonCounts[projection.visibleReason] += 1;
    promptObservationCount += nonNegative(projection.promptBudget?.observationCount);
    promptSectionCount += nonNegative(projection.promptBudget?.sectionCount);
    promptTrimmedSectionCount += nonNegative(projection.promptBudget?.statusCounts?.trimmed);
    promptBypassedSectionCount += nonNegative(projection.promptBudget?.statusCounts?.bypassed);
    promptTrimmedTokenCount += nonNegative(projection.promptBudget?.totalTrimmedTokens);
    cacheObservationCount += nonNegative(projection.cache?.observationCount);
    cacheHitCount += nonNegative(projection.cache?.statusCounts?.hit);
    cacheMissCount += nonNegative(projection.cache?.statusCounts?.miss);
    cacheDegradedCount += nonNegative(projection.cache?.statusCounts?.degraded);
    cacheBypassCount += nonNegative(projection.cache?.statusCounts?.bypass);
    continuationObservationCount += nonNegative(projection.continuation?.observationCount);
    continuationCompactedCount += nonNegative(projection.continuation?.statusCounts?.compacted);
    continuationFallbackCount += nonNegative(projection.continuation?.statusCounts?.fallback);
    continuationDegradedCount += nonNegative(projection.continuation?.statusCounts?.degraded);
    continuationBypassCount += nonNegative(projection.continuation?.statusCounts?.bypass);
  }

  return {
    projectionCount: projections.length,
    scenarioCounts,
    statusCounts,
    reasonCounts,
    promptObservationCount,
    promptSectionCount,
    promptTrimmedSectionCount,
    promptBypassedSectionCount,
    promptTrimmedTokenCount,
    cacheObservationCount,
    cacheHitCount,
    cacheMissCount,
    cacheDegradedCount,
    cacheBypassCount,
    continuationObservationCount,
    continuationCompactedCount,
    continuationFallbackCount,
    continuationDegradedCount,
    continuationBypassCount,
  };
}

export function evaluateVisibleBudgetFixture(fixture: unknown): VisibleBudgetEvaluation {
  const checks: VisibleBudgetCheck[] = [];
  const shapeIssues = validateFixtureShape(fixture);
  checks.push(shapeIssues.length === 0
    ? pass("fixture.shape", "Fixture has the required visible budget evidence shape.")
    : fail("fixture.shape", "Fixture shape is invalid.", shapeIssues));

  const projections = readProjections(fixture);
  checks.push(projections.length > 0
    ? pass("projection-cases.present", "Fixture includes visible budget projection cases.")
    : fail("projection-cases.present", "Fixture must include at least one visible budget projection.", ["visibleBudgetProjections must contain at least one row."]));

  const coverageIssues = validateScenarioCoverage(projections);
  checks.push(coverageIssues.length === 0
    ? pass("scenario-coverage.present", "Fixture covers happy-path, scoped-review, and fallback-review scenarios.")
    : fail("scenario-coverage.present", "Visible budget scenario coverage is incomplete.", coverageIssues));

  const vocabularyIssues = validateVocabulary(projections);
  checks.push(vocabularyIssues.length === 0
    ? pass("vocabulary.bounded", "Visible budget scenarios, statuses, and reasons use bounded vocabulary.")
    : fail("vocabulary.bounded", "Visible budget vocabulary is invalid.", vocabularyIssues));

  const safetyIssues = validateProjectionSafety(projections);
  checks.push(safetyIssues.length === 0
    ? pass("projection-safety.valid", "Projection scenarios match bounded status/reason decisions and counts.")
    : fail("projection-safety.valid", "Visible budget projection safety rules are invalid.", safetyIssues));

  const totalsIssues = validateDeclaredTotals(fixture, projections);
  checks.push(totalsIssues.length === 0
    ? pass("totals.deterministic", "Declared visible budget totals match deterministic projection aggregation.")
    : fail("totals.deterministic", "Declared visible budget totals do not match deterministic aggregation.", totalsIssues));

  const redactionIssues = validateRedaction(fixture);
  checks.push(redactionIssues.length === 0
    ? pass("redaction.safe", "Visible budget fixture is text-free, fingerprint-free, cache-key-free, and bounded.")
    : fail("redaction.safe", "Visible budget fixture contains raw text, raw fingerprints/cache keys, candidates, model output, or unbounded values.", redactionIssues));

  const failedChecks = checks.filter((check) => check.status === "fail");
  return {
    status: failedChecks.length === 0 ? "pass" : "fail",
    checks,
    totals: aggregateVisibleBudgetProjections(projections),
  };
}

function aggregatePromptBudgetEvidence(observations: readonly PromptBudgetEvidenceObservation[]): VisiblePromptBudgetCounts {
  const statusCounts = zeroPromptStatusCounts();
  const reasonCounts = zeroPromptReasonCounts();
  let sectionCount = 0;
  let totalBudgetTokens = 0;
  let totalIncludedTokens = 0;
  let totalTrimmedTokens = 0;

  for (const observation of observations) {
    for (const section of observation.sections) {
      sectionCount += 1;
      if (isPromptBudgetEvidenceStatus(section.budgetStatus)) statusCounts[section.budgetStatus] += 1;
      if (isPromptBudgetEvidenceReason(section.budgetReason)) reasonCounts[section.budgetReason] += 1;
      totalBudgetTokens += nonNegative(section.budgetTokens);
      totalIncludedTokens += nonNegative(section.includedTokens);
      totalTrimmedTokens += nonNegative(section.trimmedTokens);
    }
  }

  return {
    observationCount: observations.length,
    sectionCount,
    statusCounts,
    reasonCounts,
    totalBudgetTokens,
    totalIncludedTokens,
    totalTrimmedTokens,
  };
}

function aggregateCacheTelemetry(observations: readonly ReviewCacheTelemetryObservation[]): VisibleCacheCounts {
  const totals = aggregateReviewCacheTelemetryObservations(observations);
  return {
    observationCount: totals.observationCount,
    statusCounts: totals.statusCounts,
    reasonCounts: totals.reasonCounts,
    bookkeepingErrorCount: totals.bookkeepingErrorCount,
    missingSignalCount: totals.missingSignalNames.length,
    invalidationSignalCount: totals.invalidationSignalNames.length,
  };
}

function aggregateContinuationCompaction(observations: readonly ContinuationCompactionObservation[]): VisibleContinuationCounts {
  const totals = aggregateContinuationCompactionObservations(observations);
  return {
    observationCount: totals.observationCount,
    statusCounts: totals.statusCounts,
    reasonCounts: totals.reasonCounts,
    fallbackStateCounts: totals.fallbackStateCounts,
    includedDeltaCount: totals.includedDeltaCount,
    reusedCheckpointCount: totals.reusedCheckpointCount,
    omittedScopeCount: totals.omittedScopeCount,
    remainingScopeCount: totals.remainingScopeCount,
    safetySignalCount: totals.safetySignalNames.length,
    budgetSignalCount: totals.budgetSignalNames.length,
    cacheSignalCount: totals.cacheSignalNames.length,
    missingSignalCount: totals.missingSignalNames.length,
  };
}

function chooseVisibleReason(promptBudget: VisiblePromptBudgetCounts, cache: VisibleCacheCounts, continuation: VisibleContinuationCounts): VisibleBudgetReason {
  if (continuation.statusCounts.fallback > 0) return "continuation-fallback";
  if (promptBudget.statusCounts.trimmed > 0 || promptBudget.statusCounts.bypassed > 0) return "prompt-budget-limited";
  if (continuation.statusCounts.compacted > 0 || continuation.statusCounts.degraded > 0) return "continuation-compacted";
  if (cache.statusCounts.degraded > 0 || cache.statusCounts.bypass > 0) return "cache-degraded";
  return "within-budget";
}

function chooseVisibleStatus(reason: VisibleBudgetReason): VisibleBudgetStatus {
  if (reason === "continuation-fallback") return "fallback";
  if (reason === "within-budget") return "complete";
  return "scoped";
}

function validateFixtureShape(fixture: unknown): string[] {
  if (!isPlainObject(fixture)) return ["Fixture root must be an object."];
  const issues: string[] = [];
  if (!Array.isArray(fixture.visibleBudgetProjections)) issues.push("visibleBudgetProjections must be an array.");
  if (!isPlainObject(fixture.visibleBudgetSummary)) issues.push("visibleBudgetSummary must be an object.");
  return issues;
}

function validateScenarioCoverage(projections: readonly VisibleBudgetProjection[]): string[] {
  const counts = aggregateVisibleBudgetProjections(projections).scenarioCounts;
  const issues: string[] = [];
  for (const scenario of VISIBLE_BUDGET_SCENARIOS) {
    if (counts[scenario] === 0) issues.push(`missing ${scenario} projection.`);
  }
  return issues;
}

function validateVocabulary(projections: readonly VisibleBudgetProjection[]): string[] {
  const issues: string[] = [];
  projections.forEach((projection, index) => {
    const prefix = `visibleBudgetProjections[${index}]`;
    if (!isVisibleBudgetScenario(projection.scenario)) issues.push(`${prefix}.scenario is not allowed.`);
    if (!isVisibleBudgetStatus(projection.visibleStatus)) issues.push(`${prefix}.visibleStatus is not allowed.`);
    if (!isVisibleBudgetReason(projection.visibleReason)) issues.push(`${prefix}.visibleReason is not allowed.`);
    validateNumberMap(projection.promptBudget?.statusCounts, PROMPT_BUDGET_STATUSES, `${prefix}.promptBudget.statusCounts`, issues);
    validateNumberMap(projection.promptBudget?.reasonCounts, PROMPT_BUDGET_REASONS, `${prefix}.promptBudget.reasonCounts`, issues);
    validateNumberMap(projection.cache?.statusCounts, REVIEW_CACHE_TELEMETRY_STATUSES, `${prefix}.cache.statusCounts`, issues);
    validateNumberMap(projection.cache?.reasonCounts, REVIEW_CACHE_TELEMETRY_REASONS, `${prefix}.cache.reasonCounts`, issues);
    validateNumberMap(projection.continuation?.statusCounts, CONTINUATION_COMPACTION_STATUSES, `${prefix}.continuation.statusCounts`, issues);
    validateNumberMap(projection.continuation?.reasonCounts, CONTINUATION_COMPACTION_REASONS, `${prefix}.continuation.reasonCounts`, issues);
    validateNumberMap(projection.continuation?.fallbackStateCounts, CONTINUATION_COMPACTION_FALLBACK_STATES, `${prefix}.continuation.fallbackStateCounts`, issues);
  });
  return issues;
}

function validateProjectionSafety(projections: readonly VisibleBudgetProjection[]): string[] {
  const issues: string[] = [];
  projections.forEach((projection, index) => {
    const prefix = `visibleBudgetProjections[${index}]`;
    validateProjectionCounts(projection, prefix, issues);

    if (projection.scenario === "happy-path") {
      if (projection.visibleStatus !== "complete") issues.push(`${prefix} happy-path scenario requires complete status.`);
      if (projection.visibleReason !== "within-budget") issues.push(`${prefix} happy-path scenario requires within-budget reason.`);
    }
    if (projection.scenario === "scoped-review") {
      if (projection.visibleStatus !== "scoped") issues.push(`${prefix} scoped-review scenario requires scoped status.`);
      const expectedReason = expectedScopedReason(projection);
      if (projection.visibleReason !== expectedReason) issues.push(`${prefix} scoped-review scenario requires ${expectedReason} reason.`);
    }
    if (projection.scenario === "fallback-review") {
      if (projection.visibleStatus !== "fallback") issues.push(`${prefix} fallback-review scenario requires fallback status.`);
      if (projection.visibleReason !== "continuation-fallback") issues.push(`${prefix} fallback-review scenario requires continuation-fallback reason.`);
      if (projection.continuation.statusCounts.fallback <= 0) issues.push(`${prefix} fallback-review scenario requires at least one continuation fallback count.`);
    }
  });
  return issues;
}

function validateProjectionCounts(projection: VisibleBudgetProjection, prefix: string, issues: string[]): void {
  validateCount(projection.promptBudget?.observationCount, `${prefix}.promptBudget.observationCount`, issues);
  validateCount(projection.promptBudget?.sectionCount, `${prefix}.promptBudget.sectionCount`, issues);
  validateCount(projection.promptBudget?.totalBudgetTokens, `${prefix}.promptBudget.totalBudgetTokens`, issues);
  validateCount(projection.promptBudget?.totalIncludedTokens, `${prefix}.promptBudget.totalIncludedTokens`, issues);
  validateCount(projection.promptBudget?.totalTrimmedTokens, `${prefix}.promptBudget.totalTrimmedTokens`, issues);
  validateCount(projection.cache?.observationCount, `${prefix}.cache.observationCount`, issues);
  validateCount(projection.cache?.bookkeepingErrorCount, `${prefix}.cache.bookkeepingErrorCount`, issues);
  validateCount(projection.cache?.missingSignalCount, `${prefix}.cache.missingSignalCount`, issues);
  validateCount(projection.cache?.invalidationSignalCount, `${prefix}.cache.invalidationSignalCount`, issues);
  validateCount(projection.continuation?.observationCount, `${prefix}.continuation.observationCount`, issues);
  validateCount(projection.continuation?.includedDeltaCount, `${prefix}.continuation.includedDeltaCount`, issues);
  validateCount(projection.continuation?.reusedCheckpointCount, `${prefix}.continuation.reusedCheckpointCount`, issues);
  validateCount(projection.continuation?.omittedScopeCount, `${prefix}.continuation.omittedScopeCount`, issues);
  validateCount(projection.continuation?.remainingScopeCount, `${prefix}.continuation.remainingScopeCount`, issues);
  validateCount(projection.continuation?.safetySignalCount, `${prefix}.continuation.safetySignalCount`, issues);
  validateCount(projection.continuation?.budgetSignalCount, `${prefix}.continuation.budgetSignalCount`, issues);
  validateCount(projection.continuation?.cacheSignalCount, `${prefix}.continuation.cacheSignalCount`, issues);
  validateCount(projection.continuation?.missingSignalCount, `${prefix}.continuation.missingSignalCount`, issues);
}

function expectedScopedReason(projection: VisibleBudgetProjection): VisibleBudgetReason {
  if (projection.promptBudget.statusCounts.trimmed > 0 || projection.promptBudget.statusCounts.bypassed > 0) return "prompt-budget-limited";
  if (projection.continuation.statusCounts.compacted > 0 || projection.continuation.statusCounts.degraded > 0) return "continuation-compacted";
  return "cache-degraded";
}

function validateDeclaredTotals(fixture: unknown, projections: readonly VisibleBudgetProjection[]): string[] {
  if (!isPlainObject(fixture) || !isPlainObject(fixture.visibleBudgetSummary)) return ["visibleBudgetSummary is required to prove deterministic totals."];
  const expected = aggregateVisibleBudgetProjections(projections);
  const actual = fixture.visibleBudgetSummary;
  const issues: string[] = [];
  compareNumber(actual, expected, "projectionCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "promptObservationCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "promptSectionCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "promptTrimmedSectionCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "promptBypassedSectionCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "promptTrimmedTokenCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "cacheObservationCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "cacheHitCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "cacheMissCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "cacheDegradedCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "cacheBypassCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "continuationObservationCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "continuationCompactedCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "continuationFallbackCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "continuationDegradedCount", "visibleBudgetSummary", issues);
  compareNumber(actual, expected, "continuationBypassCount", "visibleBudgetSummary", issues);
  compareNumberMap(actual.scenarioCounts, expected.scenarioCounts, "visibleBudgetSummary.scenarioCounts", issues);
  compareNumberMap(actual.statusCounts, expected.statusCounts, "visibleBudgetSummary.statusCounts", issues);
  compareNumberMap(actual.reasonCounts, expected.reasonCounts, "visibleBudgetSummary.reasonCounts", issues);
  return issues;
}

function compareNumber(actual: Record<string, unknown>, expected: VisibleBudgetSummary, key: keyof Omit<VisibleBudgetSummary, "scenarioCounts" | "statusCounts" | "reasonCounts">, path: string, issues: string[]): void {
  const value = actual[key];
  if (!isFiniteNonNegativeInteger(value)) {
    issues.push(`${path}.${key} must be a non-negative integer.`);
    return;
  }
  if (value !== expected[key]) issues.push(`${path}.${key} expected ${expected[key]} but found ${value}.`);
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

function readProjections(fixture: unknown): VisibleBudgetProjection[] {
  if (!isPlainObject(fixture) || !Array.isArray(fixture.visibleBudgetProjections)) return [];
  return fixture.visibleBudgetProjections.filter(isPlainObject).map((row) => ({
    scenario: row.scenario as VisibleBudgetScenario,
    visibleStatus: row.visibleStatus as VisibleBudgetStatus,
    visibleReason: row.visibleReason as VisibleBudgetReason,
    promptBudget: readPromptCounts(row.promptBudget),
    cache: readCacheCounts(row.cache),
    continuation: readContinuationCounts(row.continuation),
  }));
}

function readPromptCounts(value: unknown): VisiblePromptBudgetCounts {
  const row = isPlainObject(value) ? value : {};
  return {
    observationCount: readNumber(row.observationCount),
    sectionCount: readNumber(row.sectionCount),
    statusCounts: readNumberMap(row.statusCounts, PROMPT_BUDGET_STATUSES),
    reasonCounts: readNumberMap(row.reasonCounts, PROMPT_BUDGET_REASONS),
    totalBudgetTokens: readNumber(row.totalBudgetTokens),
    totalIncludedTokens: readNumber(row.totalIncludedTokens),
    totalTrimmedTokens: readNumber(row.totalTrimmedTokens),
  };
}

function readCacheCounts(value: unknown): VisibleCacheCounts {
  const row = isPlainObject(value) ? value : {};
  return {
    observationCount: readNumber(row.observationCount),
    statusCounts: readNumberMap(row.statusCounts, REVIEW_CACHE_TELEMETRY_STATUSES),
    reasonCounts: readNumberMap(row.reasonCounts, REVIEW_CACHE_TELEMETRY_REASONS),
    bookkeepingErrorCount: readNumber(row.bookkeepingErrorCount),
    missingSignalCount: readNumber(row.missingSignalCount),
    invalidationSignalCount: readNumber(row.invalidationSignalCount),
  };
}

function readContinuationCounts(value: unknown): VisibleContinuationCounts {
  const row = isPlainObject(value) ? value : {};
  return {
    observationCount: readNumber(row.observationCount),
    statusCounts: readNumberMap(row.statusCounts, CONTINUATION_COMPACTION_STATUSES),
    reasonCounts: readNumberMap(row.reasonCounts, CONTINUATION_COMPACTION_REASONS),
    fallbackStateCounts: readNumberMap(row.fallbackStateCounts, CONTINUATION_COMPACTION_FALLBACK_STATES),
    includedDeltaCount: readNumber(row.includedDeltaCount),
    reusedCheckpointCount: readNumber(row.reusedCheckpointCount),
    omittedScopeCount: readNumber(row.omittedScopeCount),
    remainingScopeCount: readNumber(row.remainingScopeCount),
    safetySignalCount: readNumber(row.safetySignalCount),
    budgetSignalCount: readNumber(row.budgetSignalCount),
    cacheSignalCount: readNumber(row.cacheSignalCount),
    missingSignalCount: readNumber(row.missingSignalCount),
  };
}

function validateNumberMap<K extends string>(actual: unknown, keys: readonly K[], path: string, issues: string[]): void {
  if (!isPlainObject(actual)) {
    issues.push(`${path} must be an object.`);
    return;
  }
  for (const key of keys) {
    validateCount(actual[key], `${path}.${key}`, issues);
  }
}

function readNumberMap<K extends string>(actual: unknown, keys: readonly K[]): Record<K, number> {
  const row = isPlainObject(actual) ? actual : {};
  return Object.fromEntries(keys.map((key) => [key, readNumber(row[key])])) as Record<K, number>;
}

function validateCount(value: unknown, path: string, issues: string[]): void {
  if (!isFiniteNonNegativeInteger(value)) issues.push(`${path} must be a non-negative integer.`);
}

function readNumber(value: unknown): number {
  return typeof value === "number" ? value : -1;
}

function nonNegative(value: unknown): number {
  return isFiniteNonNegativeInteger(value) ? value : 0;
}

function zeroPromptStatusCounts(): Record<PromptBudgetEvidenceStatus, number> {
  return Object.fromEntries(PROMPT_BUDGET_STATUSES.map((status) => [status, 0])) as Record<PromptBudgetEvidenceStatus, number>;
}

function zeroPromptReasonCounts(): Record<PromptBudgetEvidenceReason, number> {
  return Object.fromEntries(PROMPT_BUDGET_REASONS.map((reason) => [reason, 0])) as Record<PromptBudgetEvidenceReason, number>;
}

function zeroScenarioCounts(): Record<VisibleBudgetScenario, number> {
  return Object.fromEntries(VISIBLE_BUDGET_SCENARIOS.map((scenario) => [scenario, 0])) as Record<VisibleBudgetScenario, number>;
}

function zeroVisibleStatusCounts(): Record<VisibleBudgetStatus, number> {
  return Object.fromEntries(VISIBLE_BUDGET_STATUSES.map((status) => [status, 0])) as Record<VisibleBudgetStatus, number>;
}

function zeroVisibleReasonCounts(): Record<VisibleBudgetReason, number> {
  return Object.fromEntries(VISIBLE_BUDGET_REASONS.map((reason) => [reason, 0])) as Record<VisibleBudgetReason, number>;
}

function pass(id: VisibleBudgetCheckId, message: string): VisibleBudgetCheck {
  return { id, status: "pass", message, issues: [] };
}

function fail(id: VisibleBudgetCheckId, message: string, issues: readonly string[]): VisibleBudgetCheck {
  return { id, status: "fail", message, issues: boundIssues(issues) };
}

function boundIssues(issues: readonly string[]): string[] {
  return issues.slice(0, MAX_ISSUES).map((issue) => issue.length > 220 ? `${issue.slice(0, 217)}...` : issue);
}

function isVisibleBudgetScenario(value: unknown): value is VisibleBudgetScenario {
  return typeof value === "string" && ALLOWED_SCENARIOS.has(value as VisibleBudgetScenario);
}

function isVisibleBudgetStatus(value: unknown): value is VisibleBudgetStatus {
  return typeof value === "string" && ALLOWED_STATUSES.has(value as VisibleBudgetStatus);
}

function isVisibleBudgetReason(value: unknown): value is VisibleBudgetReason {
  return typeof value === "string" && ALLOWED_REASONS.has(value as VisibleBudgetReason);
}

function isPromptBudgetEvidenceStatus(value: unknown): value is PromptBudgetEvidenceStatus {
  return typeof value === "string" && (PROMPT_BUDGET_STATUSES as readonly string[]).includes(value);
}

function isPromptBudgetEvidenceReason(value: unknown): value is PromptBudgetEvidenceReason {
  return typeof value === "string" && (PROMPT_BUDGET_REASONS as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}
