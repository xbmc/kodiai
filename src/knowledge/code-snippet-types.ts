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

  close(): void;
};
