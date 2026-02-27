// Retrieval (primary API)
export { createRetriever, type RetrieveOptions, type RetrieveResult, type TriggerType } from "./retrieval.ts";

// Hybrid search
export { hybridSearchMerge, type HybridSearchResult } from "./hybrid-search.ts";

// Cross-corpus RRF
export { crossCorpusRRF, type UnifiedRetrievalChunk, type SourceType, type RankedSourceList } from "./cross-corpus-rrf.ts";

// Deduplication
export { deduplicateChunks, jaccardSimilarity } from "./dedup.ts";

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

// Wiki page store
export { createWikiPageStore } from "./wiki-store.ts";

// Wiki page chunker
export { chunkWikiPage, stripHtmlToMarkdown } from "./wiki-chunker.ts";

// Wiki page types
export type {
  WikiPageStore, WikiPageChunk, WikiPageInput,
  WikiPageRecord, WikiPageSearchResult, WikiSyncState,
} from "./wiki-types.ts";

// Wiki backfill
export { backfillWikiPages } from "./wiki-backfill.ts";
export type { WikiBackfillResult, WikiBackfillOptions } from "./wiki-backfill.ts";

// Wiki retrieval
export { searchWikiPages, type WikiKnowledgeMatch } from "./wiki-retrieval.ts";

// Wiki sync
export { createWikiSyncScheduler } from "./wiki-sync.ts";
export type { WikiSyncSchedulerOptions, WikiSyncResult } from "./wiki-sync.ts";

// Code snippet store
export { createCodeSnippetStore } from "./code-snippet-store.ts";

// Code snippet chunker
export { parseDiffHunks, buildEmbeddingText, isExcludedPath, applyHunkCap, computeContentHash } from "./code-snippet-chunker.ts";
export type { ParsedHunk } from "./code-snippet-chunker.ts";

// Code snippet types
export type {
  CodeSnippetStore, CodeSnippetRecord, CodeSnippetOccurrence, CodeSnippetSearchResult,
} from "./code-snippet-types.ts";

// Code snippet retrieval
export { searchCodeSnippets, type CodeSnippetMatch } from "./code-snippet-retrieval.ts";

// Issue retrieval
export { searchIssues, type IssueKnowledgeMatch } from "./issue-retrieval.ts";

// Issue store
export { createIssueStore } from "./issue-store.ts";

// Issue types
export type {
  IssueStore, IssueRecord, IssueInput, IssueSearchResult,
  IssueCommentRecord, IssueCommentInput, IssueCommentSearchResult,
} from "./issue-types.ts";

// Thread assembler
export {
  truncateIssueBody,
  selectTailComments,
  computeBudgetDistribution,
  assembleIssueThread,
  type ThreadAssemblyResult,
} from "./thread-assembler.ts";

// Troubleshooting retrieval
export {
  retrieveTroubleshootingContext,
  extractKeywords,
  type TroubleshootingResult,
  type TroubleshootingConfig,
  type TroubleshootingMatch,
} from "./troubleshooting-retrieval.ts";

// Confidence
export { computeConfidence, matchesSuppression } from "./confidence.ts";
