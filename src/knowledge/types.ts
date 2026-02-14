import type { FeedbackPattern } from "../feedback/types.ts";

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

export type RunStatus = 'pending' | 'running' | 'completed' | 'superseded';

export type RunStateCheck = {
  shouldProcess: boolean;
  runKey: string;
  reason: 'new' | 'duplicate' | 'superseded-prior';
  supersededRunKeys: string[];
};

export type RunStateRecord = {
  id: number;
  runKey: string;
  repo: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  deliveryId: string;
  action: string;
  status: RunStatus;
  createdAt: string;
  completedAt: string | null;
  supersededBy: string | null;
};

export type PriorFinding = {
  filePath: string;
  title: string;
  titleFingerprint: string;
  severity: FindingSeverity;
  category: FindingCategory;
  startLine: number | null;
  endLine: number | null;
  commentId: number | null;
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
  checkAndClaimRun(params: { repo: string; prNumber: number; baseSha: string; headSha: string; deliveryId: string; action: string }): RunStateCheck;
  completeRun(runKey: string): void;
  purgeOldRuns(retentionDays?: number): number;
  getLastReviewedHeadSha(params: { repo: string; prNumber: number }): string | null;
  getPriorReviewFindings(params: { repo: string; prNumber: number; limit?: number }): PriorFinding[];
  aggregateFeedbackPatterns(repo: string): FeedbackPattern[];
  clearFeedbackSuppressions(repo: string): number;
  listFeedbackSuppressions(repo: string): FeedbackPattern[];
  checkpoint(): void;
  close(): void;
};
