export type AddonCheckClassificationGate = "addon-check-classification";

export type AddonCheckClassification =
  | "expected-bounded-outcome"
  | "actionable-diagnostic"
  | "unknown";

export type AddonCheckClassificationMode =
  | "no-addons"
  | "completed-with-findings"
  | "completed-clean"
  | "partial-timeout"
  | "all-timeout"
  | "tool-unavailable"
  | "mixed-incomplete"
  | "unknown-malformed-evidence";

export type AddonCheckReasonCode =
  | "no-addons"
  | "findings-present"
  | "completed-clean"
  | "partial-timeout"
  | "all-timeout"
  | "tool-unavailable"
  | "mixed-incomplete"
  | "malformed-summary"
  | "negative-count"
  | "unsafe-reason-code"
  | "empty-reason-codes"
  | "unbounded-reason-codes"
  | "raw-canary-detected"
  | "safe-degraded"
  | "unknown-evidence";

export type AddonCheckBoundedCounts = {
  addonCount: number;
  completedCount: number;
  timedOutCount: number;
  toolNotFoundCount: number;
  findingCount: number;
  errorCount: number;
  warningCount: number;
  timeBudgetMs: number;
};

export type AddonCheckRedactionFlags = {
  rawCheckerOutputOmitted: true;
  workspacePathsOmitted: true;
  githubPayloadOmitted: true;
  boundedReasonCodes: boolean;
  unsafeInputOmitted: boolean;
  rawCanaryDetected: boolean;
  addonIdentifiersOmitted: true;
};

export type AddonCheckClassificationResult = {
  gate: AddonCheckClassificationGate;
  classification: AddonCheckClassification;
  mode: AddonCheckClassificationMode;
  reasonCodes: AddonCheckReasonCode[];
  actionableDiagnostic: boolean;
  expectedBoundedOutcome: boolean;
  counts: AddonCheckBoundedCounts;
  redaction: AddonCheckRedactionFlags;
};

type AddonSummaryLike = {
  completed?: unknown;
  timedOut?: unknown;
  toolNotFound?: unknown;
  findingCount?: unknown;
  errorCount?: unknown;
  warningCount?: unknown;
  findings?: unknown;
  [key: string]: unknown;
};

type EvidenceLike = {
  mode?: unknown;
  reasonCodes?: unknown;
  [key: string]: unknown;
};

export type AddonCheckClassificationInput = {
  deliveryId?: unknown;
  repo?: unknown;
  prNumber?: unknown;
  addonCount?: unknown;
  completedCount?: unknown;
  timedOutCount?: unknown;
  toolNotFoundCount?: unknown;
  findingCount?: unknown;
  errorCount?: unknown;
  warningCount?: unknown;
  timeBudgetMs?: unknown;
  addons?: unknown;
  summaries?: unknown;
  evidence?: EvidenceLike | null;
  [key: string]: unknown;
};

const MAX_REASON_CODES = 8;
const MAX_COUNT = 10_000;
const MAX_TIME_BUDGET_MS = 3_600_000;

const REASON_CODES = new Set<AddonCheckReasonCode>([
  "no-addons",
  "findings-present",
  "completed-clean",
  "partial-timeout",
  "all-timeout",
  "tool-unavailable",
  "mixed-incomplete",
  "malformed-summary",
  "negative-count",
  "unsafe-reason-code",
  "empty-reason-codes",
  "unbounded-reason-codes",
  "raw-canary-detected",
  "safe-degraded",
  "unknown-evidence",
]);

const MODES = new Set<AddonCheckClassificationMode>([
  "no-addons",
  "completed-with-findings",
  "completed-clean",
  "partial-timeout",
  "all-timeout",
  "tool-unavailable",
  "mixed-incomplete",
  "unknown-malformed-evidence",
]);

const RAW_CANARY_KEYS = new Set([
  "rawcheckeroutput",
  "rawoutput",
  "stdout",
  "stderr",
  "checkerstdout",
  "checkerstderr",
  "workspacepath",
  "workspacedir",
  "addondir",
  "addonpath",
  "filename",
  "filepath",
  "files",
  "githubpayload",
  "payload",
  "secret",
  "secrets",
  "token",
]);

const UNSAFE_VALUE_PATTERNS = [
  /diff\s+--git/i,
  /\bTOKEN\s*=/i,
  /sk-[a-z0-9_-]{8,}/i,
  /secret/i,
  /\/home\//i,
  /\/tmp\//i,
  /\\Users\\/i,
  /kodi-addon-checker\s+--branch/i,
  /BEGIN\s+(PROMPT|CHECKER|RAW)/i,
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function boundedInteger(value: unknown, max: number): number | undefined {
  if (!isFiniteNonNegativeNumber(value)) return undefined;
  return Math.min(max, Math.floor(value));
}

function isUnsafeString(value: unknown): boolean {
  return typeof value === "string" && UNSAFE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizedKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function hasRawCanaryKeys(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  for (const key of Object.keys(value)) {
    if (RAW_CANARY_KEYS.has(normalizedKey(key))) return true;
  }
  return false;
}

function hasUnsafeKnownValues(value: unknown): boolean {
  if (isUnsafeString(value)) return true;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_REASON_CODES + 1).some(hasUnsafeKnownValues);
  }
  if (!value || typeof value !== "object") return false;

  for (const [key, child] of Object.entries(value)) {
    if (RAW_CANARY_KEYS.has(normalizedKey(key))) return true;
    if (isUnsafeString(child)) return true;
  }
  return false;
}

function asAddonSummaries(input: AddonCheckClassificationInput): AddonSummaryLike[] | undefined {
  const source = input.summaries ?? input.addons;
  if (source === undefined) return undefined;
  if (!Array.isArray(source)) return undefined;
  return source.filter((item): item is AddonSummaryLike => Boolean(item) && typeof item === "object");
}

function uniqueReasons(reasons: readonly AddonCheckReasonCode[]): AddonCheckReasonCode[] {
  const bounded: AddonCheckReasonCode[] = [];
  for (const reason of reasons) {
    if (!REASON_CODES.has(reason)) continue;
    if (bounded.includes(reason)) continue;
    bounded.push(reason);
    if (bounded.length >= MAX_REASON_CODES) break;
  }
  return bounded;
}

function parseEvidence(input: AddonCheckClassificationInput): {
  malformed: boolean;
  mode?: AddonCheckClassificationMode;
  reasonCodes?: AddonCheckReasonCode[];
  reasonFailures: AddonCheckReasonCode[];
} {
  if (!input.evidence) {
    return { malformed: false, reasonFailures: [] };
  }

  const reasonFailures: AddonCheckReasonCode[] = [];
  const mode = typeof input.evidence.mode === "string" && MODES.has(input.evidence.mode as AddonCheckClassificationMode)
    ? input.evidence.mode as AddonCheckClassificationMode
    : undefined;
  if (input.evidence.mode !== undefined && !mode) {
    reasonFailures.push("malformed-summary");
  }

  const rawReasonCodes = input.evidence.reasonCodes;
  let reasonCodes: AddonCheckReasonCode[] | undefined;
  if (rawReasonCodes !== undefined) {
    if (!Array.isArray(rawReasonCodes)) {
      reasonFailures.push("unsafe-reason-code");
    } else if (rawReasonCodes.length === 0) {
      reasonFailures.push("empty-reason-codes");
    } else if (rawReasonCodes.length > MAX_REASON_CODES) {
      reasonFailures.push("unbounded-reason-codes");
    } else {
      const safeReasons: AddonCheckReasonCode[] = [];
      for (const reason of rawReasonCodes) {
        if (typeof reason !== "string" || isUnsafeString(reason) || !REASON_CODES.has(reason as AddonCheckReasonCode)) {
          reasonFailures.push("unsafe-reason-code");
          continue;
        }
        safeReasons.push(reason as AddonCheckReasonCode);
      }
      reasonCodes = uniqueReasons(safeReasons);
      if (reasonCodes.length === 0) {
        reasonFailures.push("empty-reason-codes");
      }
    }
  }

  return {
    malformed: reasonFailures.length > 0,
    mode,
    reasonCodes,
    reasonFailures: uniqueReasons(reasonFailures),
  };
}

function hasNegativeCount(input: AddonCheckClassificationInput, summaries: AddonSummaryLike[] | undefined): boolean {
  const topLevel = [
    input.addonCount,
    input.completedCount,
    input.timedOutCount,
    input.toolNotFoundCount,
    input.findingCount,
    input.errorCount,
    input.warningCount,
    input.timeBudgetMs,
  ];
  if (topLevel.some((value) => isFiniteNumber(value) && value < 0)) return true;

  return summaries?.some((summary) => [
    summary.findingCount,
    summary.errorCount,
    summary.warningCount,
  ].some((value) => isFiniteNumber(value) && value < 0)) ?? false;
}

function isMalformedSummaries(input: AddonCheckClassificationInput, summaries: AddonSummaryLike[] | undefined): boolean {
  if ((input.addons !== undefined || input.summaries !== undefined) && !Array.isArray(input.summaries ?? input.addons)) {
    return true;
  }
  if (!summaries) return false;
  if (summaries.length > MAX_COUNT) return true;
  return summaries.some((summary) => {
    if (summary.completed !== undefined && typeof summary.completed !== "boolean") return true;
    if (summary.timedOut !== undefined && typeof summary.timedOut !== "boolean") return true;
    if (summary.toolNotFound !== undefined && typeof summary.toolNotFound !== "boolean") return true;
    if (summary.findings !== undefined && !Array.isArray(summary.findings)) return true;
    if (summary.findingCount !== undefined && !isFiniteNonNegativeNumber(summary.findingCount)) return true;
    if (summary.errorCount !== undefined && !isFiniteNonNegativeNumber(summary.errorCount)) return true;
    if (summary.warningCount !== undefined && !isFiniteNonNegativeNumber(summary.warningCount)) return true;
    return false;
  });
}

function countFindingsByLevel(summary: AddonSummaryLike, level: "ERROR" | "WARN"): number | undefined {
  if (!Array.isArray(summary.findings)) return undefined;
  let count = 0;
  for (const finding of summary.findings.slice(0, MAX_COUNT + 1)) {
    if (finding && typeof finding === "object" && (finding as { level?: unknown }).level === level) {
      count++;
    }
  }
  return Math.min(MAX_COUNT, count);
}

function buildCounts(input: AddonCheckClassificationInput, summaries: AddonSummaryLike[] | undefined): AddonCheckBoundedCounts {
  const addonCount = boundedInteger(input.addonCount, MAX_COUNT) ?? Math.min(summaries?.length ?? 0, MAX_COUNT);
  const completedFromSummaries = summaries?.filter((summary) => summary.completed === true || (summary.timedOut !== true && summary.toolNotFound !== true)).length;
  const timedOutFromSummaries = summaries?.filter((summary) => summary.timedOut === true).length;
  const toolNotFoundFromSummaries = summaries?.filter((summary) => summary.toolNotFound === true).length;

  const findingFromSummaries = summaries?.reduce((sum, summary) => {
    const explicit = boundedInteger(summary.findingCount, MAX_COUNT);
    const fromFindings = Array.isArray(summary.findings) ? boundedInteger(summary.findings.length, MAX_COUNT) : undefined;
    return Math.min(MAX_COUNT, sum + (explicit ?? fromFindings ?? 0));
  }, 0);
  const errorFromSummaries = summaries?.reduce((sum, summary) => Math.min(MAX_COUNT, sum + (boundedInteger(summary.errorCount, MAX_COUNT) ?? countFindingsByLevel(summary, "ERROR") ?? 0)), 0);
  const warningFromSummaries = summaries?.reduce((sum, summary) => Math.min(MAX_COUNT, sum + (boundedInteger(summary.warningCount, MAX_COUNT) ?? countFindingsByLevel(summary, "WARN") ?? 0)), 0);

  return {
    addonCount,
    completedCount: boundedInteger(input.completedCount, MAX_COUNT) ?? Math.min(completedFromSummaries ?? 0, MAX_COUNT),
    timedOutCount: boundedInteger(input.timedOutCount, MAX_COUNT) ?? Math.min(timedOutFromSummaries ?? 0, MAX_COUNT),
    toolNotFoundCount: boundedInteger(input.toolNotFoundCount, MAX_COUNT) ?? Math.min(toolNotFoundFromSummaries ?? 0, MAX_COUNT),
    findingCount: boundedInteger(input.findingCount, MAX_COUNT) ?? Math.min(findingFromSummaries ?? 0, MAX_COUNT),
    errorCount: boundedInteger(input.errorCount, MAX_COUNT) ?? Math.min(errorFromSummaries ?? 0, MAX_COUNT),
    warningCount: boundedInteger(input.warningCount, MAX_COUNT) ?? Math.min(warningFromSummaries ?? 0, MAX_COUNT),
    timeBudgetMs: boundedInteger(input.timeBudgetMs, MAX_TIME_BUDGET_MS) ?? 0,
  };
}

function deriveClassification(counts: AddonCheckBoundedCounts, evidenceMode?: AddonCheckClassificationMode): {
  mode: AddonCheckClassificationMode;
  reasonCodes: AddonCheckReasonCode[];
  classification: AddonCheckClassification;
  actionableDiagnostic: boolean;
  expectedBoundedOutcome: boolean;
} {
  const mode = evidenceMode ?? deriveMode(counts);
  switch (mode) {
    case "no-addons":
      return { mode, reasonCodes: ["no-addons"], classification: "expected-bounded-outcome", actionableDiagnostic: false, expectedBoundedOutcome: true };
    case "completed-with-findings":
      return { mode, reasonCodes: ["findings-present"], classification: "actionable-diagnostic", actionableDiagnostic: true, expectedBoundedOutcome: true };
    case "completed-clean":
      return { mode, reasonCodes: ["completed-clean"], classification: "expected-bounded-outcome", actionableDiagnostic: false, expectedBoundedOutcome: true };
    case "partial-timeout":
      return { mode, reasonCodes: ["partial-timeout", counts.findingCount > 0 ? "findings-present" : "completed-clean"], classification: "actionable-diagnostic", actionableDiagnostic: true, expectedBoundedOutcome: true };
    case "all-timeout":
      return { mode, reasonCodes: ["all-timeout"], classification: "actionable-diagnostic", actionableDiagnostic: true, expectedBoundedOutcome: true };
    case "tool-unavailable":
      return { mode, reasonCodes: ["tool-unavailable"], classification: "expected-bounded-outcome", actionableDiagnostic: false, expectedBoundedOutcome: true };
    case "mixed-incomplete":
      return { mode, reasonCodes: ["mixed-incomplete"], classification: "actionable-diagnostic", actionableDiagnostic: true, expectedBoundedOutcome: true };
    case "unknown-malformed-evidence":
      return { mode, reasonCodes: ["unknown-evidence", "safe-degraded"], classification: "unknown", actionableDiagnostic: false, expectedBoundedOutcome: false };
  }
}

function deriveMode(counts: AddonCheckBoundedCounts): AddonCheckClassificationMode {
  if (counts.addonCount === 0) return "no-addons";
  if (counts.toolNotFoundCount === counts.addonCount) return "tool-unavailable";
  if (counts.timedOutCount === counts.addonCount) return "all-timeout";
  if (counts.timedOutCount > 0 && counts.completedCount > 0) return "partial-timeout";
  if (counts.timedOutCount > 0 || counts.toolNotFoundCount > 0) return "mixed-incomplete";
  if (counts.findingCount > 0 || counts.errorCount > 0 || counts.warningCount > 0) return "completed-with-findings";
  if (counts.completedCount === counts.addonCount) return "completed-clean";
  return "unknown-malformed-evidence";
}

function failClosed(reasons: readonly AddonCheckReasonCode[], counts: AddonCheckBoundedCounts, rawCanaryDetected: boolean): AddonCheckClassificationResult {
  return {
    gate: "addon-check-classification",
    classification: "unknown",
    mode: "unknown-malformed-evidence",
    reasonCodes: uniqueReasons([...reasons, "safe-degraded"]),
    actionableDiagnostic: false,
    expectedBoundedOutcome: false,
    counts,
    redaction: {
      rawCheckerOutputOmitted: true,
      workspacePathsOmitted: true,
      githubPayloadOmitted: true,
      boundedReasonCodes: false,
      unsafeInputOmitted: true,
      rawCanaryDetected,
      addonIdentifiersOmitted: true,
    },
  };
}

export function classifyAddonCheckOutcome(input: AddonCheckClassificationInput): AddonCheckClassificationResult {
  const summaries = asAddonSummaries(input);
  const counts = buildCounts(input, summaries);
  const evidence = parseEvidence(input);
  const rawCanaryDetected = hasRawCanaryKeys(input) || hasRawCanaryKeys(input.evidence) || (summaries?.some(hasRawCanaryKeys) ?? false);
  const unsafeKnownValues = hasUnsafeKnownValues(input.evidence) || (summaries?.some(hasUnsafeKnownValues) ?? false);
  const malformedSummaries = isMalformedSummaries(input, summaries);
  const negativeCount = hasNegativeCount(input, summaries);

  const failReasons: AddonCheckReasonCode[] = [];
  if (evidence.malformed) failReasons.push(...evidence.reasonFailures);
  if (malformedSummaries) failReasons.push("malformed-summary");
  if (negativeCount) failReasons.push("negative-count");
  if (rawCanaryDetected) failReasons.push("raw-canary-detected");
  if (unsafeKnownValues) failReasons.push("unsafe-reason-code");

  if (failReasons.length > 0) {
    return failClosed(failReasons, counts, rawCanaryDetected);
  }

  const derived = deriveClassification(counts, evidence.mode);
  const reasonCodes = evidence.reasonCodes ? uniqueReasons(evidence.reasonCodes) : uniqueReasons(derived.reasonCodes);

  return {
    gate: "addon-check-classification",
    classification: derived.classification,
    mode: derived.mode,
    reasonCodes,
    actionableDiagnostic: derived.actionableDiagnostic,
    expectedBoundedOutcome: derived.expectedBoundedOutcome,
    counts,
    redaction: {
      rawCheckerOutputOmitted: true,
      workspacePathsOmitted: true,
      githubPayloadOmitted: true,
      boundedReasonCodes: reasonCodes.length > 0 && reasonCodes.length <= MAX_REASON_CODES,
      unsafeInputOmitted: false,
      rawCanaryDetected: false,
      addonIdentifiersOmitted: true,
    },
  };
}
