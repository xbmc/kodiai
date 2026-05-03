import { TASK_TYPES } from "../llm/task-types.ts";

export const SMALL_DIFF_MAX_FILES = 2;
export const SMALL_DIFF_MAX_LINES = 20;
export const SMALL_DIFF_MAX_TURNS = 8;
export const MEDIUM_RISK_REVIEW_MAX_TURNS = 50;
export const HIGH_RISK_REVIEW_MAX_TURNS = 75;
export const SEMANTIC_FANOUT_REVIEW_MAX_TURNS = MEDIUM_RISK_REVIEW_MAX_TURNS;

export type ReviewTimeoutRiskLevel = "low" | "medium" | "high";

export const SMALL_DIFF_REVIEW_BASE_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git diff:*)",
  "Bash(git show:*)",
] as const;

export type ReviewTaskRouting = {
  taskType: string;
  routingReason: "tiny-diff" | "standard";
  maxTurnsOverride?: number;
};

export function countChangedLinesFromNumstat(numstatLines: string[]): number {
  return numstatLines.reduce((sum, line) => {
    const [additionsRaw, deletionsRaw] = line.split(/\s+/, 2);
    const additions = Number.parseInt(additionsRaw ?? "", 10);
    const deletions = Number.parseInt(deletionsRaw ?? "", 10);

    return sum
      + (Number.isFinite(additions) ? additions : 0)
      + (Number.isFinite(deletions) ? deletions : 0);
  }, 0);
}

export function resolveReviewRoutingLineCount(params: {
  diffLinesChanged: number;
  prApiLinesChanged?: number;
}): number {
  const diffLinesChanged = Math.max(0, params.diffLinesChanged);
  const prApiLinesChanged = Math.max(0, params.prApiLinesChanged ?? 0);

  return diffLinesChanged > 0 ? diffLinesChanged : prApiLinesChanged;
}

export function isSmallDiffReviewEligible(params: {
  changedFileCount: number;
  linesChanged: number;
  hasBoundednessEscalation?: boolean;
}): boolean {
  const { changedFileCount, linesChanged, hasBoundednessEscalation = false } = params;
  return !hasBoundednessEscalation
    && changedFileCount <= SMALL_DIFF_MAX_FILES
    && linesChanged <= SMALL_DIFF_MAX_LINES;
}

export function resolveReviewTaskRouting(params: {
  changedFileCount: number;
  linesChanged: number;
  hasBoundednessEscalation?: boolean;
}): ReviewTaskRouting {
  if (isSmallDiffReviewEligible(params)) {
    return {
      taskType: TASK_TYPES.REVIEW_SMALL_DIFF,
      routingReason: "tiny-diff",
      maxTurnsOverride: SMALL_DIFF_MAX_TURNS,
    };
  }

  return {
    taskType: TASK_TYPES.REVIEW_FULL,
    routingReason: "standard",
  };
}

export function hasSemanticReviewFanout(changedFiles: readonly string[] | undefined): boolean {
  if (!changedFiles || changedFiles.length === 0) {
    return false;
  }

  return changedFiles.some((filePath) => {
    const normalized = filePath.toLowerCase();
    return normalized.includes("guilib/")
      || normalized.includes("guiwindow")
      || normalized.includes("guicontrol")
      || normalized.includes("buttoncontrol")
      || normalized.includes("windowmanager")
      || normalized.includes("playercorefactory")
      || normalized.includes("event")
      || normalized.includes("message")
      || normalized.includes("dispatcher");
  });
}

export function resolveReviewMaxTurnsOverride(params: {
  taskType: string;
  routingMaxTurnsOverride?: number;
  timeoutRiskLevel: ReviewTimeoutRiskLevel;
  baseMaxTurns: number;
  changedFiles?: readonly string[];
}): number | undefined {
  if (params.routingMaxTurnsOverride !== undefined) {
    return params.routingMaxTurnsOverride;
  }

  if (params.taskType !== TASK_TYPES.REVIEW_FULL) {
    return undefined;
  }

  const scaledMaxTurns = params.timeoutRiskLevel === "high"
    ? HIGH_RISK_REVIEW_MAX_TURNS
    : params.timeoutRiskLevel === "medium" || hasSemanticReviewFanout(params.changedFiles)
      ? SEMANTIC_FANOUT_REVIEW_MAX_TURNS
      : params.baseMaxTurns;

  return scaledMaxTurns > params.baseMaxTurns ? scaledMaxTurns : undefined;
}
