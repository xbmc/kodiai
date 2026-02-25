/**
 * Pure classification engine for CI check failures.
 *
 * Compares PR check failures against base-branch results and flakiness data
 * to determine whether each failure is likely unrelated to the PR.
 */

export type CheckResult = {
  name: string;
  conclusion: string | null;
  status: string;
};

export type Classification =
  | "unrelated"
  | "flaky-unrelated"
  | "possibly-pr-related";

export type Confidence = "high" | "medium" | "low";

export type ClassifiedFailure = {
  checkName: string;
  classification: Classification;
  confidence: Confidence;
  evidence: string;
  flakiness?: { failRate: number; window: number };
};

export type FlakinessStat = { failures: number; total: number };

const FLAKINESS_THRESHOLD = 0.3;
const FLAKINESS_MIN_RUNS = 20;

/**
 * Classify each failed check on the PR head SHA.
 *
 * Rules (in priority order):
 * 1. If the same check also fails on ANY base-branch commit → unrelated (high)
 * 2. If flakiness rate > 30% over 20+ runs → flaky-unrelated (medium)
 * 3. Otherwise → possibly-pr-related (low)
 *
 * Returns empty array when no failures exist.
 */
export function classifyFailures(params: {
  headChecks: CheckResult[];
  baseResults: Map<string, CheckResult[]>;
  flakiness: Map<string, FlakinessStat>;
}): ClassifiedFailure[] {
  const { headChecks, baseResults, flakiness } = params;

  // Filter to only failures
  const failures = headChecks.filter(
    (check) => check.conclusion === "failure",
  );

  if (failures.length === 0) return [];

  const classified: ClassifiedFailure[] = [];

  for (const check of failures) {
    // Rule 1: Check if same check name fails on any base-branch commit
    const baseMatch = findBaseFailure(check.name, baseResults);
    if (baseMatch) {
      classified.push({
        checkName: check.name,
        classification: "unrelated",
        confidence: "high",
        evidence: `Also fails on ${baseMatch.sha.slice(0, 7)}`,
      });
      continue;
    }

    // Rule 2: Check flakiness history
    const stat = flakiness.get(check.name);
    if (
      stat &&
      stat.total >= FLAKINESS_MIN_RUNS &&
      stat.failures / stat.total > FLAKINESS_THRESHOLD
    ) {
      classified.push({
        checkName: check.name,
        classification: "flaky-unrelated",
        confidence: "medium",
        evidence: "Historically flaky",
        flakiness: {
          failRate: stat.failures / stat.total,
          window: stat.total,
        },
      });
      continue;
    }

    // Rule 3: Default — possibly PR-related
    classified.push({
      checkName: check.name,
      classification: "possibly-pr-related",
      confidence: "low",
      evidence: "Passes on base branch",
    });
  }

  return classified;
}

/**
 * Find if any base-branch commit has the same check name failing.
 * Returns the first matching SHA or null.
 */
function findBaseFailure(
  checkName: string,
  baseResults: Map<string, CheckResult[]>,
): { sha: string } | null {
  for (const [sha, checks] of baseResults) {
    for (const check of checks) {
      if (check.name === checkName && check.conclusion === "failure") {
        return { sha };
      }
    }
  }
  return null;
}
