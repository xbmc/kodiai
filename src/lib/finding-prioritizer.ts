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

export function scoreFinding(_params: {
  finding: FindingForPrioritization;
  weights?: FindingPriorityWeights;
}): { score: number; scoreBreakdown: ScoredFinding["scoreBreakdown"] } {
  throw new Error("not implemented");
}

export function prioritizeFindings(_params: {
  findings: FindingForPrioritization[];
  maxComments?: number;
  weights?: FindingPriorityWeights;
}): PrioritizeFindingsResult {
  throw new Error("not implemented");
}
