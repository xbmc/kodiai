export type FindingSeverity = "critical" | "major" | "medium" | "minor";

export type FindingCategory =
  | "security"
  | "correctness"
  | "performance"
  | "style"
  | "documentation";

export type ReviewRecord = {
  repo: string;
  prNumber: number;
  headSha?: string;
  deliveryId?: string;
  filesAnalyzed: number;
  linesChanged: number;
  findingsCritical: number;
  findingsMajor: number;
  findingsMedium: number;
  findingsMinor: number;
  findingsTotal: number;
  suppressionsApplied: number;
  configSnapshot?: string;
  durationMs?: number;
  model?: string;
  conclusion: string;
};

export type FindingRecord = {
  reviewId: number;
  commentId?: number;
  commentSurface?: "pull_request_review_comment";
  reviewOutputKey?: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  severity: FindingSeverity;
  category: FindingCategory;
  confidence: number;
  title: string;
  suppressed: boolean;
  suppressionPattern?: string;
};

export type SuppressionLogEntry = {
  reviewId: number;
  pattern: string;
  matchedCount: number;
  findingIds?: number[];
};

export type RepoTopFile = {
  path: string;
  findingCount: number;
};

export type RepoStats = {
  totalReviews: number;
  totalFindings: number;
  findingsBySeverity: Record<string, number>;
  totalSuppressed: number;
  avgFindingsPerReview: number;
  avgConfidence: number;
  topFiles: RepoTopFile[];
};

export type TrendData = {
  date: string;
  reviewCount: number;
  findingsCount: number;
  suppressionsCount: number;
  avgConfidence: number;
};

export type GlobalPatternRecord = {
  severity: FindingSeverity;
  category: FindingCategory;
  confidenceBand: "high" | "medium" | "low";
  patternFingerprint: string;
  count: number;
};

export type FeedbackReaction = {
  repo: string;
  reviewId: number;
  findingId: number;
  commentId: number;
  commentSurface: "pull_request_review_comment";
  reactionId: number;
  reactionContent: "+1" | "-1";
  reactorLogin: string;
  reactedAt?: string;
  severity: FindingSeverity;
  category: FindingCategory;
  filePath: string;
  title: string;
};

export type FindingCommentCandidate = {
  findingId: number;
  reviewId: number;
  repo: string;
  commentId: number;
  commentSurface: "pull_request_review_comment";
  reviewOutputKey: string;
  severity: FindingSeverity;
  category: FindingCategory;
  filePath: string;
  title: string;
  createdAt: string;
};

export type KnowledgeStore = {
  recordReview(entry: ReviewRecord): number;
  recordFindings(findings: FindingRecord[]): void;
  recordFeedbackReactions(reactions: FeedbackReaction[]): void;
  listRecentFindingCommentCandidates(repo: string, limit?: number): FindingCommentCandidate[];
  recordSuppressionLog(entries: SuppressionLogEntry[]): void;
  recordGlobalPattern(entry: GlobalPatternRecord): void;
  getRepoStats(repo: string, sinceDays?: number): RepoStats;
  getRepoTrends(repo: string, days: number): TrendData[];
  checkpoint(): void;
  close(): void;
};
