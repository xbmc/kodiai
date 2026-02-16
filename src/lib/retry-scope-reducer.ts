import type { FileRiskScore } from "./file-risk-scorer.ts";

export type RetryScopeParams = {
  allFiles: FileRiskScore[];
  filesAlreadyReviewed: string[];
  totalFiles: number;
};

export type RetryScopeResult = {
  filesToReview: FileRiskScore[];
  scopeRatio: number;
};

export function computeRetryScope(params: RetryScopeParams): RetryScopeResult {
  const { allFiles, filesAlreadyReviewed, totalFiles } = params;
  const reviewedSet = new Set(filesAlreadyReviewed);

  const remaining = allFiles
    .filter((f) => !reviewedSet.has(f.filePath))
    .sort((a, b) => b.score - a.score);

  if (remaining.length === 0) {
    return { filesToReview: [], scopeRatio: 0 };
  }

  const reviewedFraction = totalFiles > 0 ? filesAlreadyReviewed.length / totalFiles : 0;
  const scopeRatio = Math.min(1.0, 0.5 + reviewedFraction * 0.5);
  const targetCount = Math.max(1, Math.ceil(remaining.length * scopeRatio));

  return {
    filesToReview: remaining.slice(0, targetCount),
    scopeRatio,
  };
}
