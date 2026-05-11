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
