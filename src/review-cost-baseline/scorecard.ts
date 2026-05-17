import type { PromptSectionMetric } from "../telemetry/types.ts";
import type { ReviewPhaseName, ReviewPhaseStatus } from "../execution/types.ts";

export type ReviewCostBaselineCheckId =
  | "cases.present"
  | "prompt-sections.present"
  | "retrieval-cache.valid"
  | "continuation.attributed"
  | "runtime-usage.present"
  | "phase-latency.present"
  | "redaction.safe";

export type ReviewCostBaselineCheckStatus = "pass" | "fail";

export type ReviewCostBaselineCheck = {
  id: ReviewCostBaselineCheckId;
  status: ReviewCostBaselineCheckStatus;
  message: string;
  caseId?: string;
  deliveryId?: string;
  issues: string[];
};

export type ReviewCostReplayCase = {
  caseId: string;
  label: string;
  repo: string;
  scenario: "normal" | "continuation" | "retry";
  deliveryIds: string[];
};

export type PromptSectionObservation = {
  caseId: string;
  deliveryId: string;
  repo: string;
  taskType: string;
  promptKind: string;
  sections: PromptSectionMetric[];
};

export type RetrievalCacheStatus = "hit" | "miss" | "degraded" | "bypass";

export type RetrievalCacheObservation = {
  caseId: string;
  deliveryId: string;
  evidenceType: string;
  status: RetrievalCacheStatus;
  cacheHitRate: number;
  reusedUnits: number;
  primaryWorkUnits: number;
  skippedQueries: number;
  retryAttempts: number;
};

export type ContinuationKind = "initial" | "continuation" | "retry";

export type ContinuationRetryObservation = {
  caseId: string;
  deliveryId: string;
  kind: ContinuationKind;
  parentDeliveryId?: string;
  retryScopeRatio?: number;
  checkpointFilesReviewed?: number;
  retryFilesCount?: number;
};

export type RuntimeTokenCostObservation = {
  caseId: string;
  deliveryId: string;
  taskType: string;
  provider: string;
  model: string;
  sdk: "agent" | "ai";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  durationMs?: number;
  usedFallback: boolean;
};

export type PhaseLatencyObservation = {
  caseId: string;
  deliveryId: string;
  phase: ReviewPhaseName;
  status: ReviewPhaseStatus;
  durationMs?: number;
};

export type ReviewCostBaselineInput = {
  generatedAt?: string;
  cases: ReviewCostReplayCase[];
  promptSections: PromptSectionObservation[];
  retrievalCache: RetrievalCacheObservation[];
  continuations: ContinuationRetryObservation[];
  runtimeUsage: RuntimeTokenCostObservation[];
  phaseLatencies: PhaseLatencyObservation[];
};

export type PromptSectionCostSummary = {
  promptKind: string;
  sectionName: string;
  executions: number;
  totalCharCount: number;
  totalEstimatedTokens: number;
  truncatedExecutions: number;
};

export type RetrievalCacheSummary = {
  evidenceType: string;
  statuses: RetrievalCacheStatus[];
  executions: number;
  reusedUnits: number;
  primaryWorkUnits: number;
  skippedQueries: number;
  retryAttempts: number;
  avgCacheHitRate: number;
};

export type ContinuationRetrySummary = {
  initialDeliveries: number;
  continuationDeliveries: number;
  retryDeliveries: number;
  attributedChildDeliveries: number;
  missingParentDeliveries: string[];
};

export type RuntimeTokenCostSummary = {
  executions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
};

export type PhaseLatencySummary = {
  phase: ReviewPhaseName;
  executions: number;
  totalDurationMs: number;
  statuses: ReviewPhaseStatus[];
};

export type ReviewCostCaseScorecard = {
  caseId: string;
  label: string;
  scenario: ReviewCostReplayCase["scenario"];
  deliveryIds: string[];
  promptSections: PromptSectionCostSummary[];
  retrievalCache: RetrievalCacheSummary[];
  continuationRetry: ContinuationRetrySummary;
  runtimeUsage: RuntimeTokenCostSummary;
  phaseLatencies: PhaseLatencySummary[];
  checks: ReviewCostBaselineCheck[];
};

export type ReviewCostBaselineTotals = {
  caseCount: number;
  deliveryCount: number;
  promptEstimatedTokens: number;
  promptCharCount: number;
  runtimeInputTokens: number;
  runtimeOutputTokens: number;
  runtimeCacheReadTokens: number;
  runtimeCacheWriteTokens: number;
  runtimeTotalTokens: number;
  runtimeEstimatedCostUsd: number;
  runtimeDurationMs: number;
  phaseLatencyMs: number;
};

export type ReviewCostBaselineScorecard = {
  generatedAt: string;
  status: ReviewCostBaselineCheckStatus;
  totals: ReviewCostBaselineTotals;
  cases: ReviewCostCaseScorecard[];
  checks: ReviewCostBaselineCheck[];
};

const ALLOWED_CACHE_STATUSES = new Set<RetrievalCacheStatus>(["hit", "miss", "degraded", "bypass"]);
const ALLOWED_PHASE_STATUSES = new Set<ReviewPhaseStatus>(["completed", "degraded", "unavailable"]);
const ALLOWED_SCENARIOS = new Set<ReviewCostReplayCase["scenario"]>(["normal", "continuation", "retry"]);
const ALLOWED_CONTINUATION_KINDS = new Set<ContinuationKind>(["initial", "continuation", "retry"]);
const ALLOWED_SDKS = new Set<RuntimeTokenCostObservation["sdk"]>(["agent", "ai"]);
const MAX_BOUNDED_STRING_LENGTH = 160;
const FORBIDDEN_RAW_TEXT_KEYS = /(^|_)(rawPrompt|promptText|diff|patch|comment|commentBody|body|candidate|candidatePayload|modelOutput|completion|content|text)$/i;
const SECRET_LIKE_VALUE = /(ghp_|github_pat_|sk-[a-z0-9]|azure[_-]?client[_-]?secret|password\s*=|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

function emptyRuntimeSummary(): RuntimeTokenCostSummary {
  return {
    executions: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    durationMs: 0,
  };
}

function pass(id: ReviewCostBaselineCheckId, message: string, scope: Partial<ReviewCostBaselineCheck> = {}): ReviewCostBaselineCheck {
  return { id, status: "pass", message, issues: [], ...scope };
}

function fail(id: ReviewCostBaselineCheckId, message: string, issues: string[], scope: Partial<ReviewCostBaselineCheck> = {}): ReviewCostBaselineCheck {
  return { id, status: "fail", message, issues: issues.map(boundIssue), ...scope };
}

function boundIssue(issue: string): string {
  return issue.length > 220 ? `${issue.slice(0, 217)}...` : issue;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(8));
}

function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}

function sortedUnique<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function pushMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

function validateCase(rawCase: unknown, index: number): string[] {
  const issues: string[] = [];
  if (!isPlainObject(rawCase)) {
    return [`cases[${index}] is not an object.`];
  }
  if (!isNonEmptyString(rawCase.caseId)) issues.push(`cases[${index}] is missing caseId.`);
  if (!isNonEmptyString(rawCase.label)) issues.push(`cases[${index}] is missing label.`);
  if (!isNonEmptyString(rawCase.repo)) issues.push(`cases[${index}] is missing repo.`);
  if (!ALLOWED_SCENARIOS.has(rawCase.scenario as ReviewCostReplayCase["scenario"])) issues.push(`cases[${index}] has invalid scenario.`);
  if (!Array.isArray(rawCase.deliveryIds) || rawCase.deliveryIds.length === 0 || rawCase.deliveryIds.some((deliveryId) => !isNonEmptyString(deliveryId))) {
    issues.push(`cases[${index}] must include non-empty deliveryIds.`);
  }
  return issues;
}

function validatePromptObservation(row: unknown, index: number): string[] {
  const issues: string[] = [];
  if (!isPlainObject(row)) return [`promptSections[${index}] is not an object.`];
  for (const key of ["caseId", "deliveryId", "repo", "taskType", "promptKind"] as const) {
    if (!isNonEmptyString(row[key])) issues.push(`promptSections[${index}] is missing ${key}.`);
  }
  if (!Array.isArray(row.sections) || row.sections.length === 0) {
    issues.push(`promptSections[${index}] must include sections.`);
  } else {
    row.sections.forEach((section, sectionIndex) => {
      if (!isPlainObject(section)) {
        issues.push(`promptSections[${index}].sections[${sectionIndex}] is malformed.`);
        return;
      }
      if (!isNonEmptyString(section.sectionName)) issues.push(`promptSections[${index}].sections[${sectionIndex}] is missing sectionName.`);
      if (!isFiniteNonNegativeNumber(section.sectionPosition)) issues.push(`promptSections[${index}].sections[${sectionIndex}] has invalid sectionPosition.`);
      if (!isFiniteNonNegativeNumber(section.charCount)) issues.push(`promptSections[${index}].sections[${sectionIndex}] has invalid charCount.`);
      if (!isFiniteNonNegativeNumber(section.estimatedTokens)) issues.push(`promptSections[${index}].sections[${sectionIndex}] has invalid estimatedTokens.`);
    });
  }
  return issues;
}

function validateRetrievalObservation(row: unknown, index: number): string[] {
  const issues: string[] = [];
  if (!isPlainObject(row)) return [`retrievalCache[${index}] is not an object.`];
  for (const key of ["caseId", "deliveryId", "evidenceType"] as const) {
    if (!isNonEmptyString(row[key])) issues.push(`retrievalCache[${index}] is missing ${key}.`);
  }
  if (!ALLOWED_CACHE_STATUSES.has(row.status as RetrievalCacheStatus)) issues.push(`retrievalCache[${index}] has invalid status.`);
  for (const key of ["cacheHitRate", "reusedUnits", "primaryWorkUnits", "skippedQueries", "retryAttempts"] as const) {
    if (!isFiniteNonNegativeNumber(row[key])) issues.push(`retrievalCache[${index}] has invalid ${key}.`);
  }
  return issues;
}

function validateContinuationObservation(row: unknown, index: number): string[] {
  const issues: string[] = [];
  if (!isPlainObject(row)) return [`continuations[${index}] is not an object.`];
  for (const key of ["caseId", "deliveryId"] as const) {
    if (!isNonEmptyString(row[key])) issues.push(`continuations[${index}] is missing ${key}.`);
  }
  if (!ALLOWED_CONTINUATION_KINDS.has(row.kind as ContinuationKind)) issues.push(`continuations[${index}] has invalid kind.`);
  if ((row.kind === "continuation" || row.kind === "retry") && !isNonEmptyString(row.parentDeliveryId)) {
    issues.push(`continuations[${index}] is missing parentDeliveryId.`);
  }
  for (const key of ["retryScopeRatio", "checkpointFilesReviewed", "retryFilesCount"] as const) {
    if (row[key] !== undefined && !isFiniteNonNegativeNumber(row[key])) issues.push(`continuations[${index}] has invalid ${key}.`);
  }
  return issues;
}

function validateRuntimeObservation(row: unknown, index: number): string[] {
  const issues: string[] = [];
  if (!isPlainObject(row)) return [`runtimeUsage[${index}] is not an object.`];
  for (const key of ["caseId", "deliveryId", "taskType", "provider", "model"] as const) {
    if (!isNonEmptyString(row[key])) issues.push(`runtimeUsage[${index}] is missing ${key}.`);
  }
  if (!ALLOWED_SDKS.has(row.sdk as RuntimeTokenCostObservation["sdk"])) issues.push(`runtimeUsage[${index}] has invalid sdk.`);
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "estimatedCostUsd"] as const) {
    if (!isFiniteNonNegativeNumber(row[key])) issues.push(`runtimeUsage[${index}] has invalid ${key}.`);
  }
  if (row.durationMs !== undefined && !isFiniteNonNegativeNumber(row.durationMs)) issues.push(`runtimeUsage[${index}] has invalid durationMs.`);
  if (typeof row.usedFallback !== "boolean") issues.push(`runtimeUsage[${index}] has invalid usedFallback.`);
  return issues;
}

function validatePhaseObservation(row: unknown, index: number): string[] {
  const issues: string[] = [];
  if (!isPlainObject(row)) return [`phaseLatencies[${index}] is not an object.`];
  for (const key of ["caseId", "deliveryId", "phase"] as const) {
    if (!isNonEmptyString(row[key])) issues.push(`phaseLatencies[${index}] is missing ${key}.`);
  }
  if (!ALLOWED_PHASE_STATUSES.has(row.status as ReviewPhaseStatus)) issues.push(`phaseLatencies[${index}] has invalid status.`);
  if (row.status !== "unavailable" && !isFiniteNonNegativeNumber(row.durationMs)) issues.push(`phaseLatencies[${index}] has invalid durationMs.`);
  return issues;
}

function scanForRedactionIssues(value: unknown, path = "$", issues: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.length > MAX_BOUNDED_STRING_LENGTH) {
      issues.push(`${path} contains oversized string value.`);
    }
    if (SECRET_LIKE_VALUE.test(value)) {
      issues.push(`${path} contains secret-like value.`);
    }
    return issues;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForRedactionIssues(item, `${path}[${index}]`, issues));
    return issues;
  }

  if (!isPlainObject(value)) {
    return issues;
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RAW_TEXT_KEYS.test(key)) {
      issues.push(`${path}.${key} is a forbidden raw-text field.`);
      continue;
    }
    scanForRedactionIssues(child, `${path}.${key}`, issues);
  }
  return issues;
}

function validateInput(input: unknown): { structuralIssues: string[]; redactionIssues: string[] } {
  const structuralIssues: string[] = [];
  if (!isPlainObject(input)) {
    return {
      structuralIssues: ["Input scorecard evidence must be an object."],
      redactionIssues: scanForRedactionIssues(input),
    };
  }

  const arrays = ["cases", "promptSections", "retrievalCache", "continuations", "runtimeUsage", "phaseLatencies"] as const;
  for (const key of arrays) {
    if (!Array.isArray(input[key])) structuralIssues.push(`${key} must be an array.`);
  }

  if (Array.isArray(input.cases)) input.cases.forEach((row, index) => structuralIssues.push(...validateCase(row, index)));
  if (Array.isArray(input.promptSections)) input.promptSections.forEach((row, index) => structuralIssues.push(...validatePromptObservation(row, index)));
  if (Array.isArray(input.retrievalCache)) input.retrievalCache.forEach((row, index) => structuralIssues.push(...validateRetrievalObservation(row, index)));
  if (Array.isArray(input.continuations)) input.continuations.forEach((row, index) => structuralIssues.push(...validateContinuationObservation(row, index)));
  if (Array.isArray(input.runtimeUsage)) input.runtimeUsage.forEach((row, index) => structuralIssues.push(...validateRuntimeObservation(row, index)));
  if (Array.isArray(input.phaseLatencies)) input.phaseLatencies.forEach((row, index) => structuralIssues.push(...validatePhaseObservation(row, index)));

  return {
    structuralIssues,
    redactionIssues: scanForRedactionIssues(input),
  };
}

function summarizePromptSections(rows: PromptSectionObservation[]): PromptSectionCostSummary[] {
  const summaries = new Map<string, PromptSectionCostSummary>();
  for (const row of rows) {
    for (const section of row.sections) {
      const key = `${row.promptKind}\u0000${section.sectionName}`;
      const summary = summaries.get(key) ?? {
        promptKind: row.promptKind,
        sectionName: section.sectionName,
        executions: 0,
        totalCharCount: 0,
        totalEstimatedTokens: 0,
        truncatedExecutions: 0,
      };
      summary.executions += 1;
      summary.totalCharCount += section.charCount;
      summary.totalEstimatedTokens += section.estimatedTokens;
      if (section.truncated) summary.truncatedExecutions += 1;
      summaries.set(key, summary);
    }
  }
  return [...summaries.values()].sort((a, b) => b.totalEstimatedTokens - a.totalEstimatedTokens || a.sectionName.localeCompare(b.sectionName));
}

function summarizeRetrieval(rows: RetrievalCacheObservation[]): RetrievalCacheSummary[] {
  const summaries = new Map<string, RetrievalCacheSummary & { cacheHitRateTotal: number }>();
  for (const row of rows) {
    const summary = summaries.get(row.evidenceType) ?? {
      evidenceType: row.evidenceType,
      statuses: [],
      executions: 0,
      reusedUnits: 0,
      primaryWorkUnits: 0,
      skippedQueries: 0,
      retryAttempts: 0,
      avgCacheHitRate: 0,
      cacheHitRateTotal: 0,
    };
    summary.executions += 1;
    summary.statuses.push(row.status);
    summary.reusedUnits += row.reusedUnits;
    summary.primaryWorkUnits += row.primaryWorkUnits;
    summary.skippedQueries += row.skippedQueries;
    summary.retryAttempts += row.retryAttempts;
    summary.cacheHitRateTotal += row.cacheHitRate;
    summaries.set(row.evidenceType, summary);
  }
  return [...summaries.values()].map(({ cacheHitRateTotal, ...summary }) => ({
    ...summary,
    statuses: sortedUnique(summary.statuses),
    avgCacheHitRate: summary.executions > 0 ? roundRatio(cacheHitRateTotal / summary.executions) : 0,
  })).sort((a, b) => a.evidenceType.localeCompare(b.evidenceType));
}

function summarizeContinuation(rows: ContinuationRetryObservation[], deliveryIds: Set<string>): ContinuationRetrySummary {
  const missingParentDeliveries = new Set<string>();
  for (const row of rows) {
    if ((row.kind === "continuation" || row.kind === "retry") && (!row.parentDeliveryId || !deliveryIds.has(row.parentDeliveryId))) {
      missingParentDeliveries.add(row.deliveryId);
    }
  }
  return {
    initialDeliveries: rows.filter((row) => row.kind === "initial").length,
    continuationDeliveries: rows.filter((row) => row.kind === "continuation").length,
    retryDeliveries: rows.filter((row) => row.kind === "retry").length,
    attributedChildDeliveries: rows.filter((row) => (row.kind === "continuation" || row.kind === "retry") && row.parentDeliveryId && deliveryIds.has(row.parentDeliveryId)).length,
    missingParentDeliveries: [...missingParentDeliveries].sort((a, b) => a.localeCompare(b)),
  };
}

function summarizeRuntime(rows: RuntimeTokenCostObservation[]): RuntimeTokenCostSummary {
  const summary = emptyRuntimeSummary();
  for (const row of rows) {
    summary.executions += 1;
    summary.inputTokens += row.inputTokens;
    summary.outputTokens += row.outputTokens;
    summary.cacheReadTokens += row.cacheReadTokens;
    summary.cacheWriteTokens += row.cacheWriteTokens;
    summary.estimatedCostUsd += row.estimatedCostUsd;
    summary.durationMs += row.durationMs ?? 0;
  }
  summary.totalTokens = summary.inputTokens + summary.outputTokens;
  summary.estimatedCostUsd = roundCurrency(summary.estimatedCostUsd);
  return summary;
}

function summarizePhaseLatencies(rows: PhaseLatencyObservation[]): PhaseLatencySummary[] {
  const summaries = new Map<ReviewPhaseName, PhaseLatencySummary>();
  for (const row of rows) {
    const summary = summaries.get(row.phase) ?? {
      phase: row.phase,
      executions: 0,
      totalDurationMs: 0,
      statuses: [],
    };
    summary.executions += 1;
    summary.totalDurationMs += row.durationMs ?? 0;
    summary.statuses.push(row.status);
    summaries.set(row.phase, summary);
  }
  return [...summaries.values()].map((summary) => ({
    ...summary,
    statuses: sortedUnique(summary.statuses),
  })).sort((a, b) => a.phase.localeCompare(b.phase));
}

function buildCaseChecks(params: {
  reviewCase: ReviewCostReplayCase;
  promptRows: PromptSectionObservation[];
  retrievalRows: RetrievalCacheObservation[];
  continuationSummary: ContinuationRetrySummary;
  runtimeSummary: RuntimeTokenCostSummary;
  phaseRows: PhaseLatencyObservation[];
  redactionIssues: string[];
}): ReviewCostBaselineCheck[] {
  const { reviewCase, promptRows, retrievalRows, continuationSummary, runtimeSummary, phaseRows, redactionIssues } = params;
  const caseScope = { caseId: reviewCase.caseId };
  const checks: ReviewCostBaselineCheck[] = [];

  checks.push(promptRows.length > 0
    ? pass("prompt-sections.present", "Prompt-section size observations are present.", caseScope)
    : fail("prompt-sections.present", "Prompt-section size observations are missing.", ["No prompt section rows matched this case."], caseScope));

  checks.push(retrievalRows.length > 0 && retrievalRows.every((row) => ALLOWED_CACHE_STATUSES.has(row.status))
    ? pass("retrieval-cache.valid", "Retrieval/cache observations use known bounded statuses.", caseScope)
    : fail("retrieval-cache.valid", "Retrieval/cache observations are missing or invalid.", ["Expected at least one row with status hit, miss, degraded, or bypass."], caseScope));

  const requiresChildAttribution = reviewCase.scenario === "continuation" || reviewCase.scenario === "retry";
  checks.push(!requiresChildAttribution || continuationSummary.attributedChildDeliveries > 0 && continuationSummary.missingParentDeliveries.length === 0
    ? pass("continuation.attributed", "Continuation/retry delivery cost is attributed to a parent delivery when required.", caseScope)
    : fail("continuation.attributed", "Continuation/retry delivery cost is missing parent/child attribution.", continuationSummary.missingParentDeliveries.length > 0
      ? continuationSummary.missingParentDeliveries.map((deliveryId) => `Missing valid parentDeliveryId for ${deliveryId}.`)
      : ["Expected at least one attributed continuation/retry child delivery."], caseScope));

  checks.push(runtimeSummary.executions > 0 && runtimeSummary.totalTokens > 0
    ? pass("runtime-usage.present", "Runtime token/cost observations are present.", caseScope)
    : fail("runtime-usage.present", "Runtime token/cost observations are missing.", ["Expected positive aggregate runtime input/output token totals."], caseScope));

  checks.push(phaseRows.length > 0 && phaseRows.some((row) => (row.durationMs ?? 0) > 0)
    ? pass("phase-latency.present", "Phase latency observations are present.", caseScope)
    : fail("phase-latency.present", "Phase latency observations are missing.", ["Expected at least one phase latency row with durationMs."], caseScope));

  checks.push(redactionIssues.length === 0
    ? pass("redaction.safe", "Evidence contains only bounded text-free metric fields.", caseScope)
    : fail("redaction.safe", "Evidence contains forbidden raw-text or secret-like fields.", redactionIssues, caseScope));

  return checks;
}

function indexRows<T extends { caseId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    pushMapValue(map, row.caseId, row);
  }
  return map;
}

function emptyTotals(): ReviewCostBaselineTotals {
  return {
    caseCount: 0,
    deliveryCount: 0,
    promptEstimatedTokens: 0,
    promptCharCount: 0,
    runtimeInputTokens: 0,
    runtimeOutputTokens: 0,
    runtimeCacheReadTokens: 0,
    runtimeCacheWriteTokens: 0,
    runtimeTotalTokens: 0,
    runtimeEstimatedCostUsd: 0,
    runtimeDurationMs: 0,
    phaseLatencyMs: 0,
  };
}

export function evaluateReviewCostBaselineScorecard(input: unknown): ReviewCostBaselineScorecard {
  const validation = validateInput(input);
  const generatedAt = isPlainObject(input) && isNonEmptyString(input.generatedAt) ? input.generatedAt : new Date(0).toISOString();
  const redactionCheck = validation.redactionIssues.length === 0
    ? pass("redaction.safe", "Evidence contains only bounded text-free metric fields.")
    : fail("redaction.safe", "Evidence contains forbidden raw-text or secret-like fields.", validation.redactionIssues);

  if (validation.structuralIssues.length > 0 || !isPlainObject(input)) {
    const checks = [
      fail("cases.present", "Scorecard evidence is malformed.", validation.structuralIssues),
      redactionCheck,
    ];
    return {
      generatedAt,
      status: "fail",
      totals: emptyTotals(),
      cases: [],
      checks,
    };
  }

  const typedInput = input as ReviewCostBaselineInput;
  const promptByCase = indexRows(typedInput.promptSections);
  const retrievalByCase = indexRows(typedInput.retrievalCache);
  const continuationByCase = indexRows(typedInput.continuations);
  const runtimeByCase = indexRows(typedInput.runtimeUsage);
  const phasesByCase = indexRows(typedInput.phaseLatencies);
  const totals = emptyTotals();
  const cases: ReviewCostCaseScorecard[] = [];
  const checks: ReviewCostBaselineCheck[] = [];

  checks.push(typedInput.cases.length > 0
    ? pass("cases.present", "Replay cases are present.")
    : fail("cases.present", "Replay cases are missing.", ["Expected at least one replay case."]));
  checks.push(redactionCheck);

  for (const reviewCase of typedInput.cases) {
    const promptRows = promptByCase.get(reviewCase.caseId) ?? [];
    const retrievalRows = retrievalByCase.get(reviewCase.caseId) ?? [];
    const continuationRows = continuationByCase.get(reviewCase.caseId) ?? [];
    const runtimeRows = runtimeByCase.get(reviewCase.caseId) ?? [];
    const phaseRows = phasesByCase.get(reviewCase.caseId) ?? [];
    const deliveryIds = new Set(reviewCase.deliveryIds);
    const promptSections = summarizePromptSections(promptRows);
    const retrievalCache = summarizeRetrieval(retrievalRows);
    const continuationRetry = summarizeContinuation(continuationRows, deliveryIds);
    const runtimeUsage = summarizeRuntime(runtimeRows);
    const phaseLatencies = summarizePhaseLatencies(phaseRows);
    const caseRedactionIssues = validation.redactionIssues.filter((issue) => issue.includes(`caseId`) || issue.includes(reviewCase.caseId));
    const caseChecks = buildCaseChecks({
      reviewCase,
      promptRows,
      retrievalRows,
      continuationSummary: continuationRetry,
      runtimeSummary: runtimeUsage,
      phaseRows,
      redactionIssues: caseRedactionIssues.length > 0 ? caseRedactionIssues : validation.redactionIssues,
    });

    cases.push({
      caseId: reviewCase.caseId,
      label: reviewCase.label,
      scenario: reviewCase.scenario,
      deliveryIds: reviewCase.deliveryIds,
      promptSections,
      retrievalCache,
      continuationRetry,
      runtimeUsage,
      phaseLatencies,
      checks: caseChecks,
    });

    checks.push(...caseChecks);
    totals.caseCount += 1;
    totals.deliveryCount += reviewCase.deliveryIds.length;
    totals.promptEstimatedTokens += promptSections.reduce((sum, row) => sum + row.totalEstimatedTokens, 0);
    totals.promptCharCount += promptSections.reduce((sum, row) => sum + row.totalCharCount, 0);
    totals.runtimeInputTokens += runtimeUsage.inputTokens;
    totals.runtimeOutputTokens += runtimeUsage.outputTokens;
    totals.runtimeCacheReadTokens += runtimeUsage.cacheReadTokens;
    totals.runtimeCacheWriteTokens += runtimeUsage.cacheWriteTokens;
    totals.runtimeTotalTokens += runtimeUsage.totalTokens;
    totals.runtimeEstimatedCostUsd += runtimeUsage.estimatedCostUsd;
    totals.runtimeDurationMs += runtimeUsage.durationMs;
    totals.phaseLatencyMs += phaseLatencies.reduce((sum, row) => sum + row.totalDurationMs, 0);
  }

  totals.runtimeEstimatedCostUsd = roundCurrency(totals.runtimeEstimatedCostUsd);

  return {
    generatedAt,
    status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
    totals,
    cases,
    checks,
  };
}
