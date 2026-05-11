export const DOCS_CONFIG_TRUTH_LANE_ID = "docs-config-truth" as const;

export type ShadowSpecialistLaneId = typeof DOCS_CONFIG_TRUTH_LANE_ID;

export type ShadowSpecialistStatus = "triggered" | "skipped";

export type ShadowSpecialistSkipReason =
  | "no-changed-paths"
  | "no-operator-truth-paths";

export type ShadowSpecialistDegradedReason = "invalid-paths-ignored";

export type ShadowSpecialistErrorKind = "invalid-path-input";

export type ShadowSpecialistMetricAvailability = {
  decisionCount: number;
  duplicateCount: number;
  disagreementCount: number;
  tokenCountAvailable: boolean;
  costAvailable: boolean;
  latencyMsAvailable: boolean;
};

export type ShadowSpecialistTriggerInput = {
  changedPaths: readonly unknown[];
  correlationKey?: string | null;
};

export type ShadowSpecialistTriggerResult = {
  status: ShadowSpecialistStatus;
  laneId: ShadowSpecialistLaneId | null;
  skipReason: ShadowSpecialistSkipReason | null;
  degradedReason: ShadowSpecialistDegradedReason | null;
  errorKind: ShadowSpecialistErrorKind | null;
  matchedPaths: readonly string[];
  candidateCount: number;
  selectedLaneCount: 0 | 1;
  shadowOnly: true;
  publishesFindings: false;
  correlationKey: string | null;
  metrics: ShadowSpecialistMetricAvailability;
};

export type ShadowSpecialistOutputStatus =
  | "ok"
  | "skipped"
  | "degraded"
  | "error"
  | "unclassifiable";

export type ShadowSpecialistOutputSkipReason =
  | "not-applicable"
  | "no-candidates"
  | "missing-output";

export type ShadowSpecialistOutputDegradedReason =
  | "invalid-status"
  | "invalid-candidates"
  | "candidates-truncated"
  | "unsafe-fields-discarded";

export type ShadowSpecialistOutputErrorKind =
  | "invalid-output-shape"
  | "unsafe-publication-field";

export type ShadowSpecialistDecision =
  | "candidate"
  | "duplicate"
  | "disagreement"
  | "dismissed"
  | "unclassifiable";

export type ShadowSpecialistDisagreementCategory =
  | "docs-config-conflict"
  | "operator-runbook-gap"
  | "ambiguous-source-of-truth"
  | "unclassifiable";

export type ShadowSpecialistCandidateMetric = {
  readonly fingerprint: string;
  readonly decision: ShadowSpecialistDecision;
  readonly disagreementCategory: ShadowSpecialistDisagreementCategory | null;
  readonly duplicate: boolean;
  readonly privateOnly: true;
};

export type ShadowSpecialistOutputMetricAvailability = {
  readonly tokenCount: "available" | "unavailable";
  readonly costUsd: "available" | "unavailable";
  readonly latencyMs: "available" | "unavailable";
};

export type ShadowSpecialistDecisionCounts = Record<ShadowSpecialistDecision, number>;

export type ShadowSpecialistRedactionFlags = {
  readonly unsafeFieldCount: number;
  readonly discardedRawPayload: boolean;
  readonly discardedPublicationFields: boolean;
  readonly discardedApprovalFields: boolean;
};

export type ShadowSpecialistOutputInput = {
  readonly laneId?: unknown;
  readonly status?: unknown;
  readonly skipReason?: unknown;
  readonly candidates?: unknown;
  readonly metrics?: unknown;
  readonly deliveryId?: unknown;
  readonly reviewOutputKey?: unknown;
  readonly correlationKey?: unknown;
  readonly [key: string]: unknown;
};

export type NormalizedShadowSpecialistOutput = {
  readonly laneId: ShadowSpecialistLaneId;
  readonly status: ShadowSpecialistOutputStatus;
  readonly skipReason: ShadowSpecialistOutputSkipReason | null;
  readonly degradedReasons: readonly ShadowSpecialistOutputDegradedReason[];
  readonly errorKind: ShadowSpecialistOutputErrorKind | null;
  readonly candidates: readonly ShadowSpecialistCandidateMetric[];
  readonly candidateCount: number;
  readonly truncatedCandidateCount: number;
  readonly decisionCounts: ShadowSpecialistDecisionCounts;
  readonly duplicateCount: number;
  readonly disagreementCount: number;
  readonly metricAvailability: ShadowSpecialistOutputMetricAvailability;
  readonly metrics: {
    readonly decisionCount: number;
    readonly duplicateCount: number;
    readonly disagreementCount: number;
    readonly tokenCountAvailable: boolean;
    readonly costAvailable: boolean;
    readonly latencyMsAvailable: boolean;
  };
  readonly deliveryId: string | null;
  readonly reviewOutputKey: string | null;
  readonly correlationKey: string | null;
  readonly redactionFlags: ShadowSpecialistRedactionFlags;
  readonly shadowOnly: true;
  readonly publishesFindings: false;
};

type NormalizedPath = {
  value: string;
  matchValue: string;
};

const EMPTY_METRICS: ShadowSpecialistMetricAvailability = {
  decisionCount: 0,
  duplicateCount: 0,
  disagreementCount: 0,
  tokenCountAvailable: false,
  costAvailable: false,
  latencyMsAvailable: false,
};

const OPERATOR_TRUTH_FILE_NAMES = new Set([
  "readme.md",
  "contributing.md",
  "runbook.md",
  "runbooks.md",
  "operations.md",
  "operators.md",
]);

const MAX_SHADOW_CANDIDATES = 25;
const MAX_FINGERPRINT_LENGTH = 96;

const OUTPUT_STATUSES = new Set<ShadowSpecialistOutputStatus>([
  "ok",
  "skipped",
  "degraded",
  "error",
  "unclassifiable",
]);

const OUTPUT_SKIP_REASONS = new Set<ShadowSpecialistOutputSkipReason>([
  "not-applicable",
  "no-candidates",
  "missing-output",
]);

const DECISIONS = new Set<ShadowSpecialistDecision>([
  "candidate",
  "duplicate",
  "disagreement",
  "dismissed",
  "unclassifiable",
]);

const DISAGREEMENT_CATEGORIES = new Set<ShadowSpecialistDisagreementCategory>([
  "docs-config-conflict",
  "operator-runbook-gap",
  "ambiguous-source-of-truth",
  "unclassifiable",
]);

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
  "path",
  "line",
  "startLine",
  "suggestion",
  "finding",
  "findings",
]);

const APPROVAL_KEYS = new Set([
  "approval",
  "approved",
  "approve",
  "reviewDecision",
  "publish",
  "published",
  "shouldPublish",
]);

function makeResult(params: {
  status: ShadowSpecialistStatus;
  laneId: ShadowSpecialistLaneId | null;
  skipReason: ShadowSpecialistSkipReason | null;
  degradedReason: ShadowSpecialistDegradedReason | null;
  errorKind: ShadowSpecialistErrorKind | null;
  matchedPaths: string[];
  correlationKey: string | null;
}): ShadowSpecialistTriggerResult {
  const selectedLaneCount = params.status === "triggered" ? 1 : 0;

  return {
    status: params.status,
    laneId: params.laneId,
    skipReason: params.skipReason,
    degradedReason: params.degradedReason,
    errorKind: params.errorKind,
    matchedPaths: params.matchedPaths,
    candidateCount: params.matchedPaths.length,
    selectedLaneCount,
    shadowOnly: true,
    publishesFindings: false,
    correlationKey: params.correlationKey,
    metrics: { ...EMPTY_METRICS },
  };
}

function normalizeCorrelationKey(correlationKey: string | null | undefined): string | null {
  const normalized = correlationKey?.trim();
  return normalized ? normalized : null;
}

function normalizeChangedPath(value: unknown): NormalizedPath | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const slashPath = trimmed.replaceAll("\\", "/");
  if (
    slashPath.startsWith("/")
    || /^[a-z]:\//i.test(slashPath)
    || slashPath.includes("\0")
  ) {
    return null;
  }

  const segments = slashPath.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    return null;
  }

  const normalized = segments.join("/");
  return {
    value: normalized,
    matchValue: normalized.toLowerCase(),
  };
}

function isOperatorTruthPath(path: NormalizedPath): boolean {
  const value = path.matchValue;
  const fileName = value.split("/").at(-1) ?? value;

  return (
    value.startsWith("docs/")
    || value.startsWith("doc/")
    || value.startsWith("runbooks/")
    || value.startsWith("runbook/")
    || value.startsWith("config/")
    || value.startsWith("configs/")
    || value.startsWith(".github/workflows/")
    || /^scripts\/verify-[^/]+\.(ts|js|mjs|cjs)$/.test(value)
    || /^scripts\/.*operator.*\.(ts|js|mjs|cjs)$/.test(value)
    || /^scripts\/.*runbook.*\.(ts|js|mjs|cjs)$/.test(value)
    || OPERATOR_TRUTH_FILE_NAMES.has(fileName)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBoundedString(value: unknown, maxLength = 128): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function normalizeOutputStatus(value: unknown): {
  status: ShadowSpecialistOutputStatus;
  degraded: boolean;
} {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (OUTPUT_STATUSES.has(normalized as ShadowSpecialistOutputStatus)) {
    return { status: normalized as ShadowSpecialistOutputStatus, degraded: false };
  }

  return { status: "unclassifiable", degraded: true };
}

function normalizeSkipReason(value: unknown, status: ShadowSpecialistOutputStatus): ShadowSpecialistOutputSkipReason | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (OUTPUT_SKIP_REASONS.has(normalized as ShadowSpecialistOutputSkipReason)) {
    return normalized as ShadowSpecialistOutputSkipReason;
  }

  return status === "skipped" ? "missing-output" : null;
}

function normalizeDecision(value: unknown): ShadowSpecialistDecision {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return DECISIONS.has(normalized as ShadowSpecialistDecision)
    ? normalized as ShadowSpecialistDecision
    : "unclassifiable";
}

function normalizeDisagreementCategory(value: unknown): ShadowSpecialistDisagreementCategory | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) {
    return null;
  }

  return DISAGREEMENT_CATEGORIES.has(normalized as ShadowSpecialistDisagreementCategory)
    ? normalized as ShadowSpecialistDisagreementCategory
    : "unclassifiable";
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    return null;
  }

  return value;
}

function detectUnsafeFields(value: unknown): ShadowSpecialistRedactionFlags {
  const flags = {
    unsafeFieldCount: 0,
    discardedRawPayload: false,
    discardedPublicationFields: false,
    discardedApprovalFields: false,
  } satisfies ShadowSpecialistRedactionFlags;

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
        flags.unsafeFieldCount++;
        flags.discardedRawPayload = true;
      }
      if (PUBLICATION_KEYS.has(normalizedKey)) {
        flags.unsafeFieldCount++;
        flags.discardedPublicationFields = true;
      }
      if (APPROVAL_KEYS.has(normalizedKey)) {
        flags.unsafeFieldCount++;
        flags.discardedApprovalFields = true;
      }
      visit(nested);
    }
  };

  visit(value);
  return flags;
}

function normalizeCandidates(value: unknown): {
  candidates: ShadowSpecialistCandidateMetric[];
  invalidCandidates: boolean;
  truncatedCandidateCount: number;
} {
  if (value == null) {
    return { candidates: [], invalidCandidates: false, truncatedCandidateCount: 0 };
  }

  if (!Array.isArray(value)) {
    return { candidates: [], invalidCandidates: true, truncatedCandidateCount: 0 };
  }

  const candidates: ShadowSpecialistCandidateMetric[] = [];
  const seenFingerprints = new Set<string>();
  const boundedInput = value.slice(0, MAX_SHADOW_CANDIDATES);

  for (let index = 0; index < boundedInput.length; index++) {
    const rawCandidate = boundedInput[index];
    if (!isRecord(rawCandidate)) {
      candidates.push({
        fingerprint: `unclassifiable-${index}`,
        decision: "unclassifiable",
        disagreementCategory: null,
        duplicate: false,
        privateOnly: true,
      });
      continue;
    }

    const explicitFingerprint = normalizeBoundedString(rawCandidate.fingerprint, MAX_FINGERPRINT_LENGTH);
    const fingerprint = explicitFingerprint ?? `unclassifiable-${index}`;
    const alreadySeen = seenFingerprints.has(fingerprint);
    seenFingerprints.add(fingerprint);

    const decision = alreadySeen ? "duplicate" : normalizeDecision(rawCandidate.decision);
    const disagreementCategory = decision === "disagreement"
      ? normalizeDisagreementCategory(rawCandidate.disagreementCategory) ?? "unclassifiable"
      : normalizeDisagreementCategory(rawCandidate.disagreementCategory);

    candidates.push({
      fingerprint,
      decision,
      disagreementCategory,
      duplicate: alreadySeen || rawCandidate.duplicate === true || decision === "duplicate",
      privateOnly: true,
    });
  }

  return {
    candidates,
    invalidCandidates: false,
    truncatedCandidateCount: Math.max(0, value.length - MAX_SHADOW_CANDIDATES),
  };
}

function emptyDecisionCounts(): ShadowSpecialistDecisionCounts {
  return {
    candidate: 0,
    duplicate: 0,
    disagreement: 0,
    dismissed: 0,
    unclassifiable: 0,
  };
}

function normalizeMetricAvailability(value: unknown): ShadowSpecialistOutputMetricAvailability {
  const metrics = isRecord(value) ? value : {};

  return {
    tokenCount: normalizeNonNegativeInteger(metrics.tokenCount) === null ? "unavailable" : "available",
    costUsd: typeof metrics.costUsd === "number" && Number.isFinite(metrics.costUsd) && metrics.costUsd >= 0
      ? "available"
      : "unavailable",
    latencyMs: normalizeNonNegativeInteger(metrics.latencyMs) === null ? "unavailable" : "available",
  };
}

function appendUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

export function classifyDocsConfigTruthTrigger(
  input: ShadowSpecialistTriggerInput,
): ShadowSpecialistTriggerResult {
  const correlationKey = normalizeCorrelationKey(input.correlationKey);
  const normalizedPaths: NormalizedPath[] = [];
  let invalidPathCount = 0;

  for (const changedPath of input.changedPaths) {
    const normalized = normalizeChangedPath(changedPath);
    if (!normalized) {
      invalidPathCount++;
      continue;
    }
    normalizedPaths.push(normalized);
  }

  const uniquePaths = new Map<string, NormalizedPath>();
  for (const path of normalizedPaths) {
    if (!uniquePaths.has(path.matchValue)) {
      uniquePaths.set(path.matchValue, path);
    }
  }

  const matchedPaths = [...uniquePaths.values()]
    .filter(isOperatorTruthPath)
    .map((path) => path.value)
    .sort((a, b) => a.localeCompare(b));

  const degradedReason = invalidPathCount > 0 ? "invalid-paths-ignored" : null;
  const errorKind = invalidPathCount > 0 ? "invalid-path-input" : null;

  if (matchedPaths.length > 0) {
    return makeResult({
      status: "triggered",
      laneId: DOCS_CONFIG_TRUTH_LANE_ID,
      skipReason: null,
      degradedReason,
      errorKind,
      matchedPaths,
      correlationKey,
    });
  }

  return makeResult({
    status: "skipped",
    laneId: null,
    skipReason: normalizedPaths.length === 0 ? "no-changed-paths" : "no-operator-truth-paths",
    degradedReason,
    errorKind,
    matchedPaths: [],
    correlationKey,
  });
}

export function normalizeShadowSpecialistOutput(
  input: ShadowSpecialistOutputInput | null | undefined,
): NormalizedShadowSpecialistOutput {
  const output = isRecord(input) ? input : {};
  const unsafeFlags = detectUnsafeFields(output);
  const degradedReasons: ShadowSpecialistOutputDegradedReason[] = [];

  const { status: normalizedStatus, degraded: statusWasInvalid } = normalizeOutputStatus(output.status);
  let status = normalizedStatus;
  if (statusWasInvalid) {
    appendUnique(degradedReasons, "invalid-status");
  }

  const { candidates, invalidCandidates, truncatedCandidateCount } = normalizeCandidates(output.candidates);
  if (invalidCandidates) {
    appendUnique(degradedReasons, "invalid-candidates");
  }
  if (truncatedCandidateCount > 0) {
    appendUnique(degradedReasons, "candidates-truncated");
  }
  if (unsafeFlags.unsafeFieldCount > 0) {
    appendUnique(degradedReasons, "unsafe-fields-discarded");
  }

  if (status === "ok" && degradedReasons.length > 0) {
    status = "degraded";
  }

  const decisionCounts = emptyDecisionCounts();
  for (const candidate of candidates) {
    decisionCounts[candidate.decision]++;
  }

  const duplicateCount = candidates.filter((candidate) => candidate.duplicate).length;
  const disagreementCount = candidates.filter((candidate) => candidate.decision === "disagreement").length;
  const metricAvailability = normalizeMetricAvailability(output.metrics);

  const errorKind: ShadowSpecialistOutputErrorKind | null = unsafeFlags.discardedPublicationFields || unsafeFlags.discardedApprovalFields
    ? "unsafe-publication-field"
    : invalidCandidates || !isRecord(input)
      ? "invalid-output-shape"
      : null;

  return {
    laneId: DOCS_CONFIG_TRUTH_LANE_ID,
    status,
    skipReason: normalizeSkipReason(output.skipReason, status),
    degradedReasons,
    errorKind,
    candidates,
    candidateCount: candidates.length,
    truncatedCandidateCount,
    decisionCounts,
    duplicateCount,
    disagreementCount,
    metricAvailability,
    metrics: {
      decisionCount: candidates.length,
      duplicateCount,
      disagreementCount,
      tokenCountAvailable: metricAvailability.tokenCount === "available",
      costAvailable: metricAvailability.costUsd === "available",
      latencyMsAvailable: metricAvailability.latencyMs === "available",
    },
    deliveryId: normalizeBoundedString(output.deliveryId),
    reviewOutputKey: normalizeBoundedString(output.reviewOutputKey),
    correlationKey: normalizeBoundedString(output.correlationKey),
    redactionFlags: unsafeFlags,
    shadowOnly: true,
    publishesFindings: false,
  };
}
