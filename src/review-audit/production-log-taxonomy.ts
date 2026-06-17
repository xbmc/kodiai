import { parseReviewOutputKey } from "../review-orchestration/review-idempotency.ts";
import type { NormalizedLogAnalyticsRow } from "./log-analytics.ts";

export type ProductionLogWindowId = "last12h" | "last7d";
export type ProductionLogSourceAvailability = "present" | "missing" | "partial" | "unavailable";
export type ProductionLogIssueClassification = "app-actionable" | "azure-platform" | "transient" | "historical";
export type ProductionLogDownstreamOwner = "S02" | "S03" | "S04" | "S05" | "S06" | null;

export type ProductionLogIssueClassId =
  | "knowledge-store.undefined-write"
  | "jsonb-batch.recordset-non-array"
  | "inline-publication.line-not-commentable"
  | "candidate-publication.non-approved-missing-reason"
  | "review-timeout-classification.expected-bounded-outcome"
  | "review-timeout-classification.hard-failure"
  | "review-timeout-classification.long-run-threshold"
  | "review.timeout-or-long-run"
  | "addon-check-classification.expected-bounded-outcome"
  | "addon-check-classification.actionable-diagnostic"
  | "addon-check-classification.malformed-evidence"
  | "addon-check.timeout"
  | "azure.platform-noise";

export type ProductionLogSanitizedExample = {
  timeGenerated: string | null;
  repo: string | null;
  prNumber: number | null;
  reviewOutputKey: string | null;
  deliveryId: string | null;
};

export type ProductionLogRedactionViolation = {
  reason:
    | "raw-log-output"
    | "raw-prompt-output"
    | "raw-model-output"
    | "raw-candidate-output"
    | "raw-diff-output"
    | "secret-like-string"
    | "unbounded-array"
    | "unsafe-example-field";
  path: string;
};

export type ProductionLogRedactionMetadata = {
  passed: boolean;
  rawPayloadsExcluded: boolean;
  maxExamplesPerClass: number;
  violations: ProductionLogRedactionViolation[];
};

export type ProductionLogIssueClassSummary = {
  id: ProductionLogIssueClassId;
  title: string;
  classification: ProductionLogIssueClassification;
  downstreamOwner: ProductionLogDownstreamOwner;
  count: number;
  examples: ProductionLogSanitizedExample[];
};

export type ProductionLogSourceMetadata = {
  availability: ProductionLogSourceAvailability;
  workspaceCount: number;
  queryWindow: ProductionLogWindowId;
};

export type ProductionLogBaselineWindowReport = {
  window: ProductionLogWindowId;
  source: ProductionLogSourceMetadata;
  totalRowCount: number;
  malformedRowCount: number;
  issueClasses: ProductionLogIssueClassSummary[];
  redaction: ProductionLogRedactionMetadata;
};

export type ProductionLogBaselineReport = {
  generatedAt: string;
  windows: Record<ProductionLogWindowId, ProductionLogBaselineWindowReport>;
};

export type ProductionLogObservation = {
  classId: ProductionLogIssueClassId;
  count: number;
  examples?: ProductionLogSanitizedExample[];
};

export type ProductionLogWindowInput = {
  rows?: NormalizedLogAnalyticsRow[];
  observations?: ProductionLogObservation[];
  sourceAvailability?: ProductionLogSourceAvailability;
  workspaceCount?: number;
  maxExamplesPerClass?: number;
};

const DEFAULT_MAX_EXAMPLES_PER_CLASS = 3;
const MAX_SAFE_ARRAY_LENGTH = 10;

const ISSUE_CLASS_DEFINITIONS: Record<ProductionLogIssueClassId, Omit<ProductionLogIssueClassSummary, "count" | "examples">> = {
  "knowledge-store.undefined-write": {
    id: "knowledge-store.undefined-write",
    title: "Knowledge store write received undefined payload data",
    classification: "app-actionable",
    downstreamOwner: "S02",
  },
  "jsonb-batch.recordset-non-array": {
    id: "jsonb-batch.recordset-non-array",
    title: "JSONB batch recordset insert received a non-array payload",
    classification: "app-actionable",
    downstreamOwner: "S02",
  },
  "inline-publication.line-not-commentable": {
    id: "inline-publication.line-not-commentable",
    title: "Approved inline finding targets a GitHub line that is not commentable",
    classification: "app-actionable",
    downstreamOwner: "S03",
  },
  "candidate-publication.non-approved-missing-reason": {
    id: "candidate-publication.non-approved-missing-reason",
    title: "Candidate publication completed in non-approved mode without a safe reason",
    classification: "app-actionable",
    downstreamOwner: "S04",
  },
  "review-timeout-classification.expected-bounded-outcome": {
    id: "review-timeout-classification.expected-bounded-outcome",
    title: "Review timeout classification reported an expected bounded outcome",
    classification: "transient",
    downstreamOwner: "S05",
  },
  "review-timeout-classification.hard-failure": {
    id: "review-timeout-classification.hard-failure",
    title: "Review timeout classification reported an actionable hard failure",
    classification: "app-actionable",
    downstreamOwner: "S05",
  },
  "review-timeout-classification.long-run-threshold": {
    id: "review-timeout-classification.long-run-threshold",
    title: "Review timeout classification crossed the long-run threshold",
    classification: "app-actionable",
    downstreamOwner: "S05",
  },
  "review.timeout-or-long-run": {
    id: "review.timeout-or-long-run",
    title: "Raw or ambiguous review timeout or long-run noise",
    classification: "transient",
    downstreamOwner: "S05",
  },
  "addon-check-classification.expected-bounded-outcome": {
    id: "addon-check-classification.expected-bounded-outcome",
    title: "Addon check classification reported an expected bounded outcome",
    classification: "transient",
    downstreamOwner: "S06",
  },
  "addon-check-classification.actionable-diagnostic": {
    id: "addon-check-classification.actionable-diagnostic",
    title: "Addon check classification reported an actionable diagnostic",
    classification: "app-actionable",
    downstreamOwner: "S06",
  },
  "addon-check-classification.malformed-evidence": {
    id: "addon-check-classification.malformed-evidence",
    title: "Addon check classification failed closed on malformed evidence",
    classification: "app-actionable",
    downstreamOwner: "S06",
  },
  "addon-check.timeout": {
    id: "addon-check.timeout",
    title: "Addon check timed out",
    classification: "transient",
    downstreamOwner: "S06",
  },
  "azure.platform-noise": {
    id: "azure.platform-noise",
    title: "Azure or Container Apps platform signal separated from Kodiai application issues",
    classification: "azure-platform",
    downstreamOwner: null,
  },
};

export const PRODUCTION_LOG_ISSUE_CLASS_IDS = Object.keys(ISSUE_CLASS_DEFINITIONS) as ProductionLogIssueClassId[];

const ISSUE_CLASS_ORDER = PRODUCTION_LOG_ISSUE_CLASS_IDS;

const UNSAFE_KEY_PATTERNS: Array<[RegExp, ProductionLogRedactionViolation["reason"]]> = [
  [/^(log_s|rawlog|raw_log)$/i, "raw-log-output"],
  [/(prompt|systemprompt|developerprompt|userprompt)/i, "raw-prompt-output"],
  [/(modeloutput|model_output|rawmodel|raw_model|completion|llmresponse|llm_response)/i, "raw-model-output"],
  [/(candidatebody|candidate_body|candidatepayload|candidate_payload|rawcandidate|raw_candidate|findingbody|finding_body)/i, "raw-candidate-output"],
  [/(diff|patch|hunk)/i, "raw-diff-output"],
];

const EXPLICIT_SECRET_VALUE_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/,
  /\b(?:sk|pk)_[A-Za-z0-9]{20,}\b/,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/i,
];
const OPAQUE_IDENTIFIER_VALUE_PATTERN = /\b[A-Za-z0-9+/]{32,}={0,2}\b/;
const SAFE_OPAQUE_IDENTIFIER_LEAFS = new Set([
  "reviewOutputKey",
  "review_output_key",
  "runKey",
  "supersededRunKeys",
  "planHash",
  "candidatePublicationBridgeRecordKey",
  "candidatePublicationBridgeCorrelationKey",
]);

function emptyClassSummary(id: ProductionLogIssueClassId): ProductionLogIssueClassSummary {
  return {
    ...ISSUE_CLASS_DEFINITIONS[id],
    count: 0,
    examples: [],
  };
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readPath(source: Record<string, unknown> | null | undefined, paths: string[]): unknown {
  if (!source) {
    return undefined;
  }

  for (const path of paths) {
    let current: unknown = source;
    for (const segment of path.split(".")) {
      if (typeof current !== "object" || current === null || Array.isArray(current)) {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }

    if (current !== undefined && current !== null) {
      return current;
    }
  }

  return undefined;
}

function extractRepoAndPr(row: NormalizedLogAnalyticsRow): Pick<ProductionLogSanitizedExample, "repo" | "prNumber"> {
  const parsed = row.parsedLog;
  const explicitRepo = safeString(readPath(parsed, ["repo", "repoFullName", "repository.full_name", "repository.fullName"]));
  const explicitPr = safeNumber(readPath(parsed, ["prNumber", "pullRequestNumber", "pull_request.number", "pullRequest.number"]));

  if (explicitRepo && explicitPr) {
    return { repo: explicitRepo, prNumber: explicitPr };
  }

  if (row.reviewOutputKey) {
    const parsedKey = parseReviewOutputKey(row.reviewOutputKey);
    if (parsedKey) {
      return {
        repo: explicitRepo ?? parsedKey.repoFullName,
        prNumber: explicitPr ?? parsedKey.prNumber,
      };
    }
  }

  return {
    repo: explicitRepo,
    prNumber: explicitPr,
  };
}

function sanitizeExample(row: NormalizedLogAnalyticsRow): ProductionLogSanitizedExample {
  const parsed = row.parsedLog;
  const { repo, prNumber } = extractRepoAndPr(row);
  const deliveryId = row.deliveryId ?? safeString(readPath(parsed, ["deliveryId", "delivery_id"]));
  const reviewOutputKey = row.reviewOutputKey ?? safeString(readPath(parsed, ["reviewOutputKey", "review_output_key"]));

  return {
    timeGenerated: row.timeGenerated,
    repo,
    prNumber,
    reviewOutputKey,
    deliveryId,
  };
}

function textForClassification(row: NormalizedLogAnalyticsRow): string {
  const parsed = row.parsedLog;
  const fields = [
    row.message,
    row.containerAppName,
    row.revisionName,
    safeString(readPath(parsed, ["msg", "message"])),
    safeString(readPath(parsed, ["err.message", "error.message", "error", "errorMessage"])),
    safeString(readPath(parsed, ["reason", "reasonCode", "status", "conclusion", "phase", "component", "event", "eventType", "kind"])),
    safeString(readPath(parsed, ["publicationMode", "mode", "publishMode", "candidatePublicationMode"])),
    safeString(readPath(parsed, ["publishResolution", "failureClass", "failureReason"])),
  ];

  return fields.filter((value): value is string => Boolean(value)).join(" \n ").toLowerCase();
}

function hasMissingSafeReason(row: NormalizedLogAnalyticsRow): boolean {
  const parsed = row.parsedLog;
  const reasonCandidates = [
    readPath(parsed, ["reason", "reasonCode", "reasonCodes", "safeReason", "safeReasons", "publicationReason", "publicationReasons"]),
    row.message?.match(/reason=([^\s]+)/i)?.[1],
  ];

  return reasonCandidates.every((value) => {
    if (typeof value === "string") {
      return value.trim().length === 0;
    }
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    return true;
  });
}

function classifyStructuredReviewTimeout(row: NormalizedLogAnalyticsRow): ProductionLogIssueClassId | null {
  const parsed = row.parsedLog;
  if (!parsed || readPath(parsed, ["gate"]) !== "review-timeout-classification") {
    return null;
  }

  const classification = safeString(readPath(parsed, ["classification", "gateResult"]));
  const mode = safeString(readPath(parsed, ["mode"]));

  if (mode === "long-run-threshold-exceeded") {
    return "review-timeout-classification.long-run-threshold";
  }

  if (classification === "expected-bounded-outcome") {
    return "review-timeout-classification.expected-bounded-outcome";
  }

  if (classification === "hard-failure" || mode === "zero-evidence-hard-timeout" || mode === "zero-evidence-hard-budget-exhausted" || mode === "unknown-malformed-evidence") {
    return "review-timeout-classification.hard-failure";
  }

  return null;
}

function classifyStructuredAddonCheck(row: NormalizedLogAnalyticsRow): ProductionLogIssueClassId | null {
  const parsed = row.parsedLog;
  if (!parsed || readPath(parsed, ["gate"]) !== "addon-check-classification") {
    return null;
  }

  const classification = safeString(readPath(parsed, ["classification", "gateResult"]));
  const mode = safeString(readPath(parsed, ["mode"]));

  if (classification === "unknown" || mode === "unknown-malformed-evidence") {
    return "addon-check-classification.malformed-evidence";
  }

  if (classification === "actionable-diagnostic") {
    return "addon-check-classification.actionable-diagnostic";
  }

  if (classification === "expected-bounded-outcome") {
    return "addon-check-classification.expected-bounded-outcome";
  }

  return null;
}

export function classifyProductionLogRow(row: NormalizedLogAnalyticsRow): ProductionLogIssueClassId | null {
  if (row.malformed) {
    return null;
  }

  const structuredReviewTimeout = classifyStructuredReviewTimeout(row);
  if (structuredReviewTimeout) {
    return structuredReviewTimeout;
  }

  const structuredAddonCheck = classifyStructuredAddonCheck(row);
  if (structuredAddonCheck) {
    return structuredAddonCheck;
  }

  const text = textForClassification(row);

  if (/knowledge store write failed/.test(text) && /undefined/.test(text)) {
    return "knowledge-store.undefined-write";
  }

  if (/jsonb_to_recordset/.test(text) && /non-array/.test(text)) {
    return "jsonb-batch.recordset-non-array";
  }

  if (/line-not-commentable|not commentable|not part of the pull request diff|line.*not.*pr diff/.test(text)) {
    return "inline-publication.line-not-commentable";
  }

  if (/review candidate publication completed with non-approved mode|non-approved/.test(text) && hasMissingSafeReason(row)) {
    return "candidate-publication.non-approved-missing-reason";
  }

  if (/addon[-_\s]?check/.test(text) && /timeout|timed out|deadline|exceeded/.test(text)) {
    return "addon-check.timeout";
  }

  if (/review/.test(text) && /timeout|timed out|long-run|long run|exceeded.*(?:budget|threshold)|duration.*(?:[6-9]\d{5}|\d{7,})/.test(text)) {
    return "review.timeout-or-long-run";
  }

  if (/azure|container apps?|aca job|keda|daprd|envoy|revision|replica|pod|node|pulling image|probe failed|containerappsystemlogs|system/.test(text)) {
    return "azure.platform-noise";
  }

  return null;
}

function addViolationOnce(
  violations: ProductionLogRedactionViolation[],
  violation: ProductionLogRedactionViolation,
): void {
  if (!violations.some((existing) => existing.path === violation.path && existing.reason === violation.reason)) {
    violations.push(violation);
  }
}

function isSafeSourcePath(value: unknown): boolean {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 240
    && /^[A-Za-z0-9._/-]+$/.test(value)
    && !value.includes("..");
}

function isSafeOpaqueIdentifierPath(path: string): boolean {
  const leaf = path.split(/[.[\]]/).filter(Boolean).at(-1) ?? path;
  const parent = path.split(/[.[\]]/).filter(Boolean).at(-2);
  return SAFE_OPAQUE_IDENTIFIER_LEAFS.has(leaf) || parent === "supersededRunKeys";
}

function isSafeTelemetryField(leaf: string, value: unknown, path: string): boolean {
  if (leaf === "path") {
    return isSafeSourcePath(value);
  }
  if (leaf.endsWith("FieldCount")
    || leaf.endsWith("LinesChanged")
    || leaf.endsWith("Attempts")
    || leaf === "hunkCount"
    || leaf === "chunksWritten") {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }
  if (leaf.endsWith("Included") && typeof value === "boolean") {
    return value === false;
  }
  if (leaf.endsWith("Omitted") && typeof value === "boolean") {
    return value === true;
  }
  if (leaf === "diffRange") {
    return typeof value === "string" && /^[A-Za-z0-9/_-]+\.{2,3}[A-Za-z0-9/_-]+$/.test(value);
  }
  if (leaf === "diffCollectionStrategy") {
    return typeof value === "string" && /^[a-z][a-z0-9-]{0,40}$/.test(value);
  }
  return false;
}

function hasSecretLikeString(value: string, path: string): boolean {
  const leaf = path.split(/[.[\]]/).filter(Boolean).at(-1) ?? path;
  if (EXPLICIT_SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }
  if (leaf === "path" && isSafeSourcePath(value)) {
    return false;
  }
  return OPAQUE_IDENTIFIER_VALUE_PATTERN.test(value) && !isSafeOpaqueIdentifierPath(path);
}

function inspectValueForRedaction(
  value: unknown,
  path: string,
  violations: ProductionLogRedactionViolation[],
): void {
  const leaf = path.split(".").at(-1) ?? path;
  for (const [pattern, reason] of UNSAFE_KEY_PATTERNS) {
    if (pattern.test(leaf) && !isSafeTelemetryField(leaf, value, path)) {
      addViolationOnce(violations, { reason, path });
    }
  }

  if (typeof value === "string") {
    if (hasSecretLikeString(value, path)) {
      addViolationOnce(violations, { reason: "secret-like-string", path });
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_SAFE_ARRAY_LENGTH) {
      addViolationOnce(violations, { reason: "unbounded-array", path });
    }
    value.slice(0, MAX_SAFE_ARRAY_LENGTH).forEach((item, index) => inspectValueForRedaction(item, `${path}[${index}]`, violations));
    return;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      inspectValueForRedaction(nested, path ? `${path}.${key}` : key, violations);
    }
  }
}

function inspectExampleForRedaction(
  example: ProductionLogSanitizedExample,
  path: string,
  violations: ProductionLogRedactionViolation[],
): void {
  const allowedKeys = new Set(["timeGenerated", "repo", "prNumber", "reviewOutputKey", "deliveryId"]);
  for (const key of Object.keys(example)) {
    if (!allowedKeys.has(key)) {
      addViolationOnce(violations, { reason: "unsafe-example-field", path: `${path}.${key}` });
    }
  }
  inspectValueForRedaction(example, path, violations);
}

function buildRedactionMetadata(params: {
  rows: NormalizedLogAnalyticsRow[];
  issueClasses: ProductionLogIssueClassSummary[];
  maxExamplesPerClass: number;
}): ProductionLogRedactionMetadata {
  const violations: ProductionLogRedactionViolation[] = [];

  params.rows.forEach((row, index) => {
    if (row.parsedLog) {
      inspectValueForRedaction(row.parsedLog, `rows[${index}].parsedLog`, violations);
    }
  });

  params.issueClasses.forEach((issueClass, classIndex) => {
    issueClass.examples.forEach((example, exampleIndex) => {
      inspectExampleForRedaction(example, `issueClasses[${classIndex}].examples[${exampleIndex}]`, violations);
    });
  });

  return {
    passed: violations.length === 0,
    rawPayloadsExcluded: true,
    maxExamplesPerClass: params.maxExamplesPerClass,
    violations,
  };
}

function applyObservation(
  summaries: Map<ProductionLogIssueClassId, ProductionLogIssueClassSummary>,
  observation: ProductionLogObservation,
  maxExamplesPerClass: number,
): void {
  const summary = summaries.get(observation.classId);
  if (!summary) {
    return;
  }

  summary.count += Math.max(0, Math.floor(observation.count));
  for (const example of observation.examples ?? []) {
    if (summary.examples.length >= maxExamplesPerClass) {
      break;
    }
    summary.examples.push({
      timeGenerated: example.timeGenerated ?? null,
      repo: example.repo ?? null,
      prNumber: example.prNumber ?? null,
      reviewOutputKey: example.reviewOutputKey ?? null,
      deliveryId: example.deliveryId ?? null,
    });
  }
}

export function buildBaselineWindowFromRows(params: {
  window: ProductionLogWindowId;
  rows: NormalizedLogAnalyticsRow[];
  sourceAvailability?: ProductionLogSourceAvailability;
  workspaceCount?: number;
  maxExamplesPerClass?: number;
}): ProductionLogBaselineWindowReport {
  const maxExamplesPerClass = params.maxExamplesPerClass ?? DEFAULT_MAX_EXAMPLES_PER_CLASS;
  const summaries = new Map<ProductionLogIssueClassId, ProductionLogIssueClassSummary>(
    ISSUE_CLASS_ORDER.map((id) => [id, emptyClassSummary(id)]),
  );

  for (const row of params.rows) {
    const classId = classifyProductionLogRow(row);
    if (!classId) {
      continue;
    }

    const summary = summaries.get(classId)!;
    summary.count += 1;
    if (summary.examples.length < maxExamplesPerClass) {
      summary.examples.push(sanitizeExample(row));
    }
  }

  const issueClasses = ISSUE_CLASS_ORDER.map((id) => summaries.get(id)!);

  return {
    window: params.window,
    source: {
      availability: params.sourceAvailability ?? (params.rows.length > 0 ? "present" : "missing"),
      workspaceCount: Math.max(0, Math.floor(params.workspaceCount ?? 0)),
      queryWindow: params.window,
    },
    totalRowCount: params.rows.length,
    malformedRowCount: params.rows.filter((row) => row.malformed).length,
    issueClasses,
    redaction: buildRedactionMetadata({ rows: params.rows, issueClasses, maxExamplesPerClass }),
  };
}

export function buildBaselineWindowFromObservations(params: {
  window: ProductionLogWindowId;
  observations: ProductionLogObservation[];
  sourceAvailability?: ProductionLogSourceAvailability;
  workspaceCount?: number;
  maxExamplesPerClass?: number;
}): ProductionLogBaselineWindowReport {
  const maxExamplesPerClass = params.maxExamplesPerClass ?? DEFAULT_MAX_EXAMPLES_PER_CLASS;
  const summaries = new Map<ProductionLogIssueClassId, ProductionLogIssueClassSummary>(
    ISSUE_CLASS_ORDER.map((id) => [id, emptyClassSummary(id)]),
  );

  for (const observation of params.observations) {
    applyObservation(summaries, observation, maxExamplesPerClass);
  }

  const issueClasses = ISSUE_CLASS_ORDER.map((id) => summaries.get(id)!);
  const redactionViolations: ProductionLogRedactionViolation[] = [];
  issueClasses.forEach((issueClass, classIndex) => {
    issueClass.examples.forEach((example, exampleIndex) => {
      inspectExampleForRedaction(example, `issueClasses[${classIndex}].examples[${exampleIndex}]`, redactionViolations);
    });
  });

  return {
    window: params.window,
    source: {
      availability: params.sourceAvailability ?? (params.observations.length > 0 ? "present" : "missing"),
      workspaceCount: Math.max(0, Math.floor(params.workspaceCount ?? 0)),
      queryWindow: params.window,
    },
    totalRowCount: params.observations.reduce((sum, observation) => sum + Math.max(0, Math.floor(observation.count)), 0),
    malformedRowCount: 0,
    issueClasses,
    redaction: {
      passed: redactionViolations.length === 0,
      rawPayloadsExcluded: true,
      maxExamplesPerClass,
      violations: redactionViolations,
    },
  };
}

export function buildProductionLogBaselineReport(params: {
  generatedAt?: string;
  windows: Record<ProductionLogWindowId, ProductionLogWindowInput>;
}): ProductionLogBaselineReport {
  return {
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    windows: {
      last12h: buildWindow("last12h", params.windows.last12h),
      last7d: buildWindow("last7d", params.windows.last7d),
    },
  };
}

function buildWindow(
  window: ProductionLogWindowId,
  input: ProductionLogWindowInput,
): ProductionLogBaselineWindowReport {
  if (input.rows) {
    return buildBaselineWindowFromRows({
      window,
      rows: input.rows,
      sourceAvailability: input.sourceAvailability,
      workspaceCount: input.workspaceCount,
      maxExamplesPerClass: input.maxExamplesPerClass,
    });
  }

  return buildBaselineWindowFromObservations({
    window,
    observations: input.observations ?? [],
    sourceAvailability: input.sourceAvailability,
    workspaceCount: input.workspaceCount,
    maxExamplesPerClass: input.maxExamplesPerClass,
  });
}

export function findProductionLogIssueClass(
  report: ProductionLogBaselineWindowReport,
  classId: ProductionLogIssueClassId,
): ProductionLogIssueClassSummary {
  return report.issueClasses.find((issueClass) => issueClass.id === classId) ?? emptyClassSummary(classId);
}
