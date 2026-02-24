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

export type DepBumpSource = "dependabot" | "renovate" | "unknown";

export type SemverBumpType = "major" | "minor" | "patch" | "unknown";

export type MergeConfidenceLevel = "high" | "medium" | "low";

export type AdvisoryStatus = "none" | "present" | "unknown";

export type AdvisoryMaxSeverity = "critical" | "high" | "medium" | "low" | "unknown";

export type DepBumpMergeHistoryRecord = {
  repo: string;
  prNumber: number;

  mergedAt?: string | null;
  deliveryId?: string | null;
  source: DepBumpSource;

  signalsJson?: string | null;
  packageName?: string | null;
  oldVersion?: string | null;
  newVersion?: string | null;
  semverBumpType?: SemverBumpType | null;

  mergeConfidenceLevel?: MergeConfidenceLevel | null;
  mergeConfidenceRationaleJson?: string | null;

  advisoryStatus?: AdvisoryStatus | null;
  advisoryMaxSeverity?: AdvisoryMaxSeverity | null;
  isSecurityBump?: boolean | null;
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

export type CheckpointRecord = {
  reviewOutputKey: string;
  repo: string;
  prNumber: number;
  filesReviewed: string[];
  findingCount: number;
  summaryDraft: string;
  totalFiles: number;
  partialCommentId?: number | null;
  createdAt?: string;
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

export type AuthorCacheEntry = {
  tier: string;
  authorAssociation: string;
  prCount: number | null;
  cachedAt: string;
};

export type FindingByCommentId = {
  severity: FindingSeverity;
  category: FindingCategory;
  filePath: string;
  startLine: number | null;
  title: string;
};

export type KnowledgeStore = {
  recordReview(entry: ReviewRecord): Promise<number>;
  recordFindings(findings: FindingRecord[]): Promise<void>;
  recordFeedbackReactions(reactions: FeedbackReaction[]): Promise<void>;
  listRecentFindingCommentCandidates(repo: string, limit?: number): Promise<FindingCommentCandidate[]>;
  recordSuppressionLog(entries: SuppressionLogEntry[]): Promise<void>;
  recordGlobalPattern(entry: GlobalPatternRecord): Promise<void>;
  recordDepBumpMergeHistory(entry: DepBumpMergeHistoryRecord): Promise<void>;
  getRepoStats(repo: string, sinceDays?: number): Promise<RepoStats>;
  getRepoTrends(repo: string, days: number): Promise<TrendData[]>;
  checkAndClaimRun(params: { repo: string; prNumber: number; baseSha: string; headSha: string; deliveryId: string; action: string }): Promise<RunStateCheck>;
  completeRun(runKey: string): Promise<void>;
  purgeOldRuns(retentionDays?: number): Promise<number>;
  getAuthorCache?(params: { repo: string; authorLogin: string }): Promise<AuthorCacheEntry | null>;
  getFindingByCommentId?(params: { repo: string; commentId: number }): Promise<FindingByCommentId | null>;
  upsertAuthorCache?(params: { repo: string; authorLogin: string; tier: string; authorAssociation: string; prCount: number | null }): Promise<void>;
  purgeStaleAuthorCache?(retentionDays?: number): Promise<number>;
  getLastReviewedHeadSha(params: { repo: string; prNumber: number }): Promise<string | null>;
  getPriorReviewFindings(params: { repo: string; prNumber: number; limit?: number }): Promise<PriorFinding[]>;
  aggregateFeedbackPatterns(repo: string): Promise<FeedbackPattern[]>;
  clearFeedbackSuppressions(repo: string): Promise<number>;
  listFeedbackSuppressions(repo: string): Promise<FeedbackPattern[]>;
  saveCheckpoint?(data: CheckpointRecord): Promise<void>;
  getCheckpoint?(reviewOutputKey: string): Promise<CheckpointRecord | null>;
  deleteCheckpoint?(reviewOutputKey: string): Promise<void>;
  updateCheckpointCommentId?(reviewOutputKey: string, commentId: number): Promise<void>;
  checkpoint(): void;
  close(): void;
};

// --- Learning memory types (moved from src/learning/types.ts) ---

export type MemoryOutcome = "accepted" | "suppressed" | "thumbs_up" | "thumbs_down";

export type LearningMemoryRecord = {
  id?: number;
  repo: string;
  owner: string;
  findingId: number;
  reviewId: number;
  sourceRepo: string;
  findingText: string;
  severity: FindingSeverity;
  category: FindingCategory;
  filePath: string;
  outcome: MemoryOutcome;
  embeddingModel: string;
  embeddingDim: number;
  stale: boolean;
  createdAt?: string;
};

export type EmbeddingResult = {
  embedding: Float32Array;
  model: string;
  dimensions: number;
} | null;

export type RetrievalResult = {
  memoryId: number;
  distance: number;
  record: LearningMemoryRecord;
  sourceRepo: string;
};

export type RetrievalWithProvenance = {
  results: RetrievalResult[];
  provenance: {
    repoSources: string[];
    sharedPoolUsed: boolean;
    totalCandidates: number;
    query: {
      repo: string;
      topK: number;
      threshold: number;
    };
  };
};

export type EmbeddingConfig = {
  enabled: boolean;
  model: string;
  dimensions: number;
};

export type SharingConfig = {
  enabled: boolean;
};

export type LearningMemoryStore = {
  writeMemory(record: LearningMemoryRecord, embedding: Float32Array): Promise<void>;
  retrieveMemories(params: {
    queryEmbedding: Float32Array;
    repo: string;
    topK: number;
  }): Promise<{ memoryId: number; distance: number }[]>;
  retrieveMemoriesForOwner(params: {
    queryEmbedding: Float32Array;
    owner: string;
    excludeRepo: string;
    topK: number;
  }): Promise<{ memoryId: number; distance: number }[]>;
  getMemoryRecord(memoryId: number): Promise<LearningMemoryRecord | null>;
  markStale(embeddingModel: string): Promise<number>;
  purgeStaleEmbeddings(): Promise<number>;
  close(): void;
};

export type EmbeddingProvider = {
  generate(text: string, inputType: "document" | "query"): Promise<EmbeddingResult>;
  readonly model: string;
  readonly dimensions: number;
};
