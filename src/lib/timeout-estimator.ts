import { LANGUAGE_RISK } from "./file-risk-scorer.ts";

export type TimeoutRiskLevel = "low" | "medium" | "high";

export type TimeoutEstimate = {
  riskLevel: TimeoutRiskLevel;
  /** Backward-compatible name: this is the remote-review-runtime budget only. */
  dynamicTimeoutSeconds: number;
  remoteRuntimeBudgetSeconds: number;
  infraOverheadBudgetSeconds: number;
  totalTimeoutSeconds: number;
  shouldReduceScope: boolean;
  reducedFileCount: number | null;
  reasoning: string;
};

export const DEFAULT_INFRA_OVERHEAD_BUDGET_SECONDS = 180;
export const MAX_TIMEOUT_BUDGET_SECONDS = 1800;

/**
 * Compute a weighted-average language complexity score from a map of
 * language -> file paths.  Uses the existing LANGUAGE_RISK map from
 * file-risk-scorer.ts.
 *
 * @returns A number between 0 and 1 (defaults to 0.3 when no files present).
 */
export function computeLanguageComplexity(
  filesByLanguage: Record<string, string[]>,
): number {
  const entries = Object.entries(filesByLanguage);
  if (entries.length === 0) return 0.3;

  let totalFiles = 0;
  let weightedSum = 0;

  for (const [language, files] of entries) {
    const count = files.length;
    const risk = LANGUAGE_RISK[language] ?? LANGUAGE_RISK["Unknown"] ?? 0.3;
    weightedSum += risk * count;
    totalFiles += count;
  }

  if (totalFiles === 0) return 0.3;

  return Math.min(1, Math.max(0, weightedSum / totalFiles));
}

/**
 * Estimate timeout risk from PR metrics.  Pure function -- no I/O.
 *
 * Complexity score = fileScore * 0.4 + lineScore * 0.4 + langScore * 0.2
 *   fileScore  = min(fileCount / 100, 1.0)
 *   lineScore  = min(linesChanged / 5000, 1.0)
 *   langScore  = languageComplexity (0-1)
 *
 * Remote runtime timeout = baseTimeoutSeconds * (0.75 + complexity), clamped [30, 1800].
 * Total timeout = remote runtime timeout + fixed infra overhead cushion.
 */
export function estimateTimeoutRisk(params: {
  fileCount: number;
  linesChanged: number;
  languageComplexity: number;
  isLargePR: boolean;
  baseTimeoutSeconds: number;
}): TimeoutEstimate {
  const {
    fileCount,
    linesChanged,
    languageComplexity,
    baseTimeoutSeconds,
  } = params;

  const fileScore = Math.min(fileCount / 100, 1.0);
  const lineScore = Math.min(linesChanged / 5000, 1.0);
  const langScore = languageComplexity;

  const complexity = fileScore * 0.4 + lineScore * 0.4 + langScore * 0.2;

  // Risk level
  let riskLevel: TimeoutRiskLevel;
  if (complexity < 0.3) {
    riskLevel = "low";
  } else if (complexity < 0.6) {
    riskLevel = "medium";
  } else {
    riskLevel = "high";
  }

  // Dynamic timeout: range [0.75x, 1.75x] of base, clamped so total budget stays within platform max
  const rawTimeout = baseTimeoutSeconds * (0.75 + complexity);
  const maxRemoteRuntimeBudgetSeconds = Math.max(
    30,
    MAX_TIMEOUT_BUDGET_SECONDS - DEFAULT_INFRA_OVERHEAD_BUDGET_SECONDS,
  );
  const remoteRuntimeBudgetSeconds = Math.round(
    Math.max(30, Math.min(rawTimeout, maxRemoteRuntimeBudgetSeconds)),
  );
  const infraOverheadBudgetSeconds = DEFAULT_INFRA_OVERHEAD_BUDGET_SECONDS;
  const totalTimeoutSeconds = Math.min(
    remoteRuntimeBudgetSeconds + infraOverheadBudgetSeconds,
    MAX_TIMEOUT_BUDGET_SECONDS,
  );

  // Scope reduction
  const shouldReduceScope = riskLevel === "high";
  const reducedFileCount = shouldReduceScope ? Math.min(fileCount, 50) : null;

  const langPercent = Math.round(langScore * 100);
  const reasoning =
    `Complexity score: ${complexity.toFixed(2)} ` +
    `(files: ${fileCount}, lines: ${linesChanged}, lang risk: ${langPercent}%). ` +
    `Risk level: ${riskLevel}. ` +
    `Remote runtime budget: ${remoteRuntimeBudgetSeconds}s (base: ${baseTimeoutSeconds}s). ` +
    `Infra overhead budget: ${infraOverheadBudgetSeconds}s. ` +
    `Total timeout: ${totalTimeoutSeconds}s.`;

  return {
    riskLevel,
    dynamicTimeoutSeconds: remoteRuntimeBudgetSeconds,
    remoteRuntimeBudgetSeconds,
    infraOverheadBudgetSeconds,
    totalTimeoutSeconds,
    shouldReduceScope,
    reducedFileCount,
    reasoning,
  };
}
