/**
 * Type definitions for PR review comment storage, chunking, and retrieval.
 */

/** Raw GitHub API response fields before chunking. */
export type ReviewCommentInput = {
  repo: string;
  owner: string;
  prNumber: number;
  prTitle?: string;
  commentGithubId: number;
  inReplyToId?: number | null;
  filePath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  diffHunk?: string | null;
  authorLogin: string;
  authorAssociation?: string | null;
  body: string;
  githubCreatedAt: Date;
  githubUpdatedAt?: Date | null;
  /** For thread ID generation: original diff position or review ID */
  originalPosition?: number | null;
  reviewId?: number | null;
};

/** The unit stored and embedded: a chunk of one or more comments. */
export type ReviewCommentChunk = {
  repo: string;
  owner: string;
  prNumber: number;
  prTitle?: string | null;
  commentGithubId: number;
  threadId: string;
  inReplyToId?: number | null;
  filePath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  diffHunk?: string | null;
  authorLogin: string;
  authorAssociation?: string | null;
  body: string;
  chunkIndex: number;
  chunkText: string;
  tokenCount: number;
  githubCreatedAt: Date;
  githubUpdatedAt?: Date | null;
  backfillBatch?: string | null;
  embedding?: Float32Array | null;
};

/** Full database row type with all columns. */
export type ReviewCommentRecord = {
  id: number;
  createdAt: string;
  repo: string;
  owner: string;
  prNumber: number;
  prTitle: string | null;
  commentGithubId: number;
  threadId: string;
  inReplyToId: number | null;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  diffHunk: string | null;
  authorLogin: string;
  authorAssociation: string | null;
  body: string;
  chunkIndex: number;
  chunkText: string;
  tokenCount: number;
  embedding: unknown;
  embeddingModel: string | null;
  stale: boolean;
  githubCreatedAt: string;
  githubUpdatedAt: string | null;
  deleted: boolean;
  backfillBatch: string | null;
};

/** Search result with cosine distance score. */
export type ReviewCommentSearchResult = {
  record: ReviewCommentRecord;
  distance: number;
};

import type { EmbeddingRepairCheckpoint, EmbeddingRepairCorpus, RepairCandidateRow } from "./embedding-repair.ts";

/** Sync state tracking record for cursor-based resume. */
export type SyncState = {
  id?: number;
  repo: string;
  lastSyncedAt: Date | null;
  lastPageCursor: string | null;
  totalCommentsSynced: number;
  backfillComplete: boolean;
  updatedAt?: string;
};

export type ReviewCommentRepairCandidate = ReviewCommentRecord & {
  corpus: "review_comments";
};

/** Store interface for review comment CRUD and search operations. */
export type ReviewCommentStore = {
  /** Bulk upsert chunks (idempotent: ON CONFLICT DO NOTHING). */
  writeChunks(chunks: ReviewCommentChunk[]): Promise<void>;

  /** Soft-delete a comment by GitHub ID across all chunks. */
  softDelete(repo: string, commentGithubId: number): Promise<void>;

  /** Replace existing chunks for a comment (handles re-chunking on edit). */
  updateChunks(chunks: ReviewCommentChunk[]): Promise<void>;

  /** Vector similarity search scoped by repo. */
  searchByEmbedding(params: {
    queryEmbedding: Float32Array;
    repo: string;
    topK: number;
  }): Promise<ReviewCommentSearchResult[]>;

  /** Full-text search using tsvector GIN index. */
  searchByFullText(params: {
    query: string;
    repo: string;
    topK: number;
  }): Promise<ReviewCommentSearchResult[]>;

  /** Get all comments in a thread, ordered by creation time. */
  getThreadComments(threadId: string): Promise<ReviewCommentRecord[]>;

  /** Get sync state for a repo. */
  getSyncState(repo: string): Promise<SyncState | null>;

  /** Upsert sync state for a repo. */
  updateSyncState(state: SyncState): Promise<void>;

  /** Get the most recent comment date for incremental sync. */
  getLatestCommentDate(repo: string): Promise<Date | null>;

  /** Count total comments for a repo (non-deleted). */
  countByRepo(repo: string): Promise<number>;

  /** Find chunks with null embeddings for sweep recovery. */
  getNullEmbeddingChunks(repo: string, limit: number): Promise<ReviewCommentRecord[]>;

  /** Update embedding for a single chunk by ID. */
  updateEmbedding(id: number, embedding: Float32Array, model: string): Promise<void>;

  /** Count chunks with null embeddings for health monitoring. */
  countNullEmbeddings(repo: string): Promise<number>;

  /** Get comment by GitHub ID for edit detection in catch-up sync. */
  getByGithubId(repo: string, commentGithubId: number): Promise<ReviewCommentRecord | null>;

  /** List degraded persisted rows that need row-local embedding repair. */
  listRepairCandidates?(corpus: EmbeddingRepairCorpus): Promise<RepairCandidateRow[]>;

  /** Read the durable generic repair state for the corpus. */
  getRepairState?(corpus: EmbeddingRepairCorpus): Promise<EmbeddingRepairCheckpoint | null>;

  /** Persist the durable generic repair state for the corpus. */
  saveRepairState?(state: EmbeddingRepairCheckpoint): Promise<void>;

  /** Batch-update repaired embeddings for a bounded row set. */
  writeRepairEmbeddingsBatch?(payload: {
    corpus: EmbeddingRepairCorpus;
    row_ids: number[];
    target_model: string;
    embeddings: Array<{ row_id: number; embedding: Float32Array }>;
  }): Promise<void>;
};
