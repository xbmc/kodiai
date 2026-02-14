export type FindingSeverity = "critical" | "major" | "medium" | "minor";

export type FindingCategory =
  | "security"
  | "correctness"
  | "performance"
  | "style"
  | "documentation";

export type FindingPriorityWeights = {
  severity: number;
  fileRisk: number;
  category: number;
  recurrence: number;
};

export type FindingForPrioritization = {
  filePath: string;
  title: string;
  severity: string;
  category: string;
  fileRiskScore?: number;
  recurrenceCount?: number;
};

export type ScoredFinding = FindingForPrioritization & {
  score: number;
  scoreBreakdown: {
    severity: number;
    fileRisk: number;
    category: number;
    recurrence: number;
  };
  originalIndex: number;
};

export type PrioritizeFindingsResult = {
  rankedFindings: ScoredFinding[];
  selectedFindings: ScoredFinding[];
  stats: {
    findingsScored: number;
    topScore: number | null;
    thresholdScore: number | null;
  };
};

export const DEFAULT_FINDING_PRIORITY_WEIGHTS: FindingPriorityWeights = {
  severity: 0.45,
  fileRisk: 0.3,
  category: 0.15,
  recurrence: 0.1,
};

const SEVERITY_SCORES: Record<string, number> = {
  critical: 100,
  major: 80,
  medium: 30,
  minor: 15,
};

const CATEGORY_SCORES: Record<string, number> = {
  security: 80,
  correctness: 80,
  performance: 60,
  documentation: 35,
  style: 25,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeWeights(
  weights?: FindingPriorityWeights,
): FindingPriorityWeights {
  const candidate = weights ?? DEFAULT_FINDING_PRIORITY_WEIGHTS;
  const sanitized: FindingPriorityWeights = {
    severity: Math.max(0, candidate.severity),
    fileRisk: Math.max(0, candidate.fileRisk),
    category: Math.max(0, candidate.category),
    recurrence: Math.max(0, candidate.recurrence),
  };
  const sum =
    sanitized.severity +
    sanitized.fileRisk +
    sanitized.category +
    sanitized.recurrence;

  if (sum <= 0) {
    return DEFAULT_FINDING_PRIORITY_WEIGHTS;
  }

  return {
    severity: sanitized.severity / sum,
    fileRisk: sanitized.fileRisk / sum,
    category: sanitized.category / sum,
    recurrence: sanitized.recurrence / sum,
  };
}

function normalizeSeverityScore(severity: string): number {
  return SEVERITY_SCORES[severity.trim().toLowerCase()] ?? 50;
}

function normalizeCategoryScore(category: string): number {
  return CATEGORY_SCORES[category.trim().toLowerCase()] ?? 50;
}

function normalizeFileRiskScore(fileRiskScore?: number): number {
  return clamp(fileRiskScore ?? 0, 0, 100);
}

function normalizeRecurrenceScore(recurrenceCount?: number): number {
  const safeCount = clamp(recurrenceCount ?? 0, 0, 5);
  return (safeCount / 5) * 100;
}

export function scoreFinding(params: {
  finding: FindingForPrioritization;
  weights?: FindingPriorityWeights;
}): { score: number; scoreBreakdown: ScoredFinding["scoreBreakdown"] } {
  const { finding, weights } = params;
  const normalizedWeights = normalizeWeights(weights);

  const scoreBreakdown = {
    severity: normalizeSeverityScore(finding.severity),
    fileRisk: normalizeFileRiskScore(finding.fileRiskScore),
    category: normalizeCategoryScore(finding.category),
    recurrence: normalizeRecurrenceScore(finding.recurrenceCount),
  };

  const weightedScore =
    scoreBreakdown.severity * normalizedWeights.severity +
    scoreBreakdown.fileRisk * normalizedWeights.fileRisk +
    scoreBreakdown.category * normalizedWeights.category +
    scoreBreakdown.recurrence * normalizedWeights.recurrence;

  return {
    score: Number(weightedScore.toFixed(2)),
    scoreBreakdown,
  };
}

export function prioritizeFindings(params: {
  findings: FindingForPrioritization[];
  maxComments?: number;
  weights?: FindingPriorityWeights;
}): PrioritizeFindingsResult {
  const { findings, maxComments, weights } = params;
  const limit =
    typeof maxComments === "number" && Number.isFinite(maxComments)
      ? Math.max(0, Math.floor(maxComments))
      : findings.length;

  const rankedFindings: ScoredFinding[] = findings
    .map((finding, index) => {
      const scored = scoreFinding({ finding, weights });
      return {
        ...finding,
        score: scored.score,
        scoreBreakdown: scored.scoreBreakdown,
        originalIndex: index,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.originalIndex - b.originalIndex;
    });

  const selectedFindings = rankedFindings.slice(0, limit);

  return {
    rankedFindings,
    selectedFindings,
    stats: {
      findingsScored: findings.length,
      topScore: rankedFindings[0]?.score ?? null,
      thresholdScore: selectedFindings[selectedFindings.length - 1]?.score ?? null,
    },
  };
}
