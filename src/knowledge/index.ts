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

// Confidence
export { computeConfidence, matchesSuppression } from "./confidence.ts";
