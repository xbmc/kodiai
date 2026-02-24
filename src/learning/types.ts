import type { FindingSeverity, FindingCategory } from "../knowledge/types.ts";

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
