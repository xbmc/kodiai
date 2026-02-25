// Retrieval (primary API)
export { createRetriever, type RetrieveOptions, type RetrieveResult } from "./retrieval.ts";

// Embeddings
export { createEmbeddingProvider, createNoOpEmbeddingProvider } from "./embeddings.ts";

// Memory store
export { createLearningMemoryStore } from "./memory-store.ts";

// Isolation
export { createIsolationLayer, type IsolationLayer } from "./isolation.ts";

// Knowledge store (reviews, findings, etc.)
export { createKnowledgeStore } from "./store.ts";

// Types (re-export all)
export type {
  EmbeddingProvider, EmbeddingResult, EmbeddingConfig,
  LearningMemoryRecord, LearningMemoryStore, MemoryOutcome,
  RetrievalResult, RetrievalWithProvenance,
  SharingConfig,
  KnowledgeStore, ReviewRecord, FindingRecord,
  FindingSeverity, FindingCategory,
} from "./types.ts";

// Review comment store
export { createReviewCommentStore } from "./review-comment-store.ts";

// Review comment chunker
export { chunkReviewThread } from "./review-comment-chunker.ts";

// Review comment types
export type {
  ReviewCommentStore, ReviewCommentChunk, ReviewCommentSearchResult,
  ReviewCommentRecord, ReviewCommentInput, SyncState,
} from "./review-comment-types.ts";

// Review comment backfill
export { backfillReviewComments, syncSinglePR } from "./review-comment-backfill.ts";
export type { BackfillResult, BackfillOptions } from "./review-comment-backfill.ts";

// Review comment retrieval
export { searchReviewComments, type ReviewCommentMatch } from "./review-comment-retrieval.ts";

// Confidence
export { computeConfidence, matchesSuppression } from "./confidence.ts";
