import type { PriorFinding } from "../knowledge/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeltaStatus = "new" | "resolved" | "still-open";

/**
 * Minimal input shape for findings entering delta classification.
 * Intentionally decoupled from ProcessedFinding in review.ts to avoid
 * circular imports. Any object with at least these fields qualifies.
 */
export type FindingForDelta = {
  filePath: string;
  title: string;
  severity: string;
  category: string;
  commentId: number;
  suppressed: boolean;
  confidence: number;
};

/**
 * A current finding annotated with its delta status relative to
 * the prior review run.
 */
export type DeltaClassifiedFinding = FindingForDelta & {
  deltaStatus: DeltaStatus;
};

/**
 * Full delta classification result: annotated current findings,
 * resolved prior findings, and aggregate counts.
 */
export type DeltaClassification = {
  current: DeltaClassifiedFinding[];
  resolved: Array<{
    filePath: string;
    title: string;
    severity: string;
    category: string;
  }>;
  counts: {
    new: number;
    resolved: number;
    stillOpen: number;
  };
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Compare current review findings against prior review findings using
 * `filePath:titleFingerprint` composite keys to classify each finding
 * as `new`, `still-open`, or `resolved`.
 *
 * - **new**: present in current but not in prior
 * - **still-open**: present in both current and prior
 * - **resolved**: present in prior but not in current
 *
 * The `fingerprintFn` is injected for testability (callers pass the
 * real FNV-1a `fingerprintFindingTitle` in production).
 */
export function classifyFindingDeltas(params: {
  currentFindings: FindingForDelta[];
  priorFindings: PriorFinding[];
  fingerprintFn: (title: string) => string;
}): DeltaClassification {
  const { currentFindings, priorFindings, fingerprintFn } = params;

  // Build a Map of prior fingerprint keys -> PriorFinding
  const priorKeys = new Map<string, PriorFinding>();
  for (const prior of priorFindings) {
    const key = `${prior.filePath}:${prior.titleFingerprint}`;
    priorKeys.set(key, prior);
  }

  // Classify each current finding
  const matchedPriorKeys = new Set<string>();
  const classified: DeltaClassifiedFinding[] = [];

  for (const finding of currentFindings) {
    const fp = fingerprintFn(finding.title);
    const key = `${finding.filePath}:${fp}`;
    const deltaStatus: DeltaStatus = priorKeys.has(key)
      ? "still-open"
      : "new";

    if (deltaStatus === "still-open") {
      matchedPriorKeys.add(key);
    }

    classified.push({ ...finding, deltaStatus });
  }

  // Prior findings not matched by any current finding -> resolved
  const resolved: DeltaClassification["resolved"] = [];
  for (const [key, prior] of priorKeys) {
    if (!matchedPriorKeys.has(key)) {
      resolved.push({
        filePath: prior.filePath,
        title: prior.title,
        severity: prior.severity,
        category: prior.category,
      });
    }
  }

  return {
    current: classified,
    resolved,
    counts: {
      new: classified.filter((f) => f.deltaStatus === "new").length,
      resolved: resolved.length,
      stillOpen: classified.filter((f) => f.deltaStatus === "still-open")
        .length,
    },
  };
}
