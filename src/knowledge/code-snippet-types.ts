import type { EmbeddingRepairCheckpoint, EmbeddingRepairCorpus } from "./embedding-repair.ts";

/**
 * Types for hunk-level code snippet embedding with content-hash deduplication.
 *
 * Architecture: code_snippets table stores unique embedded text (keyed by SHA-256 hash),
 * code_snippet_occurrences junction table links each hash to PR/file/line metadata.
 */

export type CodeSnippetRecord = {
  id: number;
  contentHash: string;
  embeddedText: string;
  language: string;
  embeddingModel: string | null;
  stale: boolean;
  createdAt: string;
};

export type CodeSnippetOccurrence = {
  id: number;
  contentHash: string;
  repo: string;
  owner: string;
  prNumber: number;
  prTitle: string | null;
  filePath: string;
  startLine: number;
  endLine: number;
  functionContext: string | null;
  createdAt: string;
};

export type CodeSnippetSearchResult = {
  contentHash: string;
  embeddedText: string;
  distance: number;
  language: string;
  /** Best occurrence metadata (most recent PR). */
  repo: string;
  prNumber: number;
  prTitle: string | null;
  filePath: string;
  startLine: number;
  endLine: number;
  createdAt: string;
};

export type CodeSnippetRepairCandidate = {
  id: number;
  corpus: "code_snippets";
  embedding: unknown;
  embeddingModel: string | null;
  stale: boolean;
  embeddedText: string;
  language: string | null;
};

export type CodeSnippetStore = {
  writeSnippet(
    record: {
      contentHash: string;
      embeddedText: string;
      language: string;
      embeddingModel: string;
    },
    embedding: Float32Array,
  ): Promise<void>;

  writeOccurrence(
    occurrence: Omit<CodeSnippetOccurrence, "id" | "createdAt">,
  ): Promise<void>;

  searchByEmbedding(params: {
    queryEmbedding: Float32Array;
    repo: string;
    topK: number;
    distanceThreshold?: number;
  }): Promise<CodeSnippetSearchResult[]>;

  searchByFullText?(params: {
    query: string;
    repo: string;
    topK: number;
  }): Promise<CodeSnippetSearchResult[]>;

  /** List degraded persisted rows that need row-local embedding repair. */
  listRepairCandidates?(corpus: EmbeddingRepairCorpus): Promise<CodeSnippetRepairCandidate[]>;

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

  close(): void;
};
