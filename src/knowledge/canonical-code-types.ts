/**
 * Types for the canonical current-code corpus.
 *
 * This corpus records HEAD-snapshot chunks with full repo/ref/commit provenance.
 * It is deliberately SEPARATE from the historical diff-hunk snippet corpus
 * (code-snippet-types.ts / migration 009). Historical snippets are tied to PR
 * occurrences; canonical chunks represent the current state of a default branch.
 *
 * Design decisions:
 *   - Chunk identity is (repo, owner, canonical_ref, file_path, chunk_type,
 *     symbol_name) — stable enough for incremental replacement when a file changes.
 *   - content_hash (SHA-256 of chunk_text) guards against unnecessary re-embedding.
 *   - symbol_name is nullable: present for named function/class/method chunks,
 *     null for fallback fixed-size block chunks (symbol-poor C++ files, etc.).
 *   - ChunkType is a discriminated union matching the SQL CHECK constraint values.
 */

// ── Chunk type discriminants ──────────────────────────────────────────────────

/** Logical type of a canonical code chunk. */
export type CanonicalChunkType = "function" | "class" | "method" | "module" | "block";

// ── Chunk identity ────────────────────────────────────────────────────────────

/**
 * The stable logical key that identifies a canonical chunk.
 * Used for upserts, incremental replacement, and audit queries.
 * symbol_name is null for fallback block chunks.
 */
export type CanonicalChunkIdentity = {
  repo: string;
  owner: string;
  canonicalRef: string;   // e.g. "main", "master", "develop"
  filePath: string;
  chunkType: CanonicalChunkType;
  symbolName: string | null;
};

// ── Core record types ─────────────────────────────────────────────────────────

/**
 * A fully hydrated canonical code chunk row (all columns).
 */
export type CanonicalCodeChunk = {
  id: bigint;
  repo: string;
  owner: string;
  canonicalRef: string;
  commitSha: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  chunkType: CanonicalChunkType;
  symbolName: string | null;
  chunkText: string;
  contentHash: string;
  embeddingModel: string | null;
  stale: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Input record for writing a canonical chunk.
 * Does not include generated/managed fields (id, tsv, created_at, updated_at).
 */
export type CanonicalChunkWriteInput = {
  repo: string;
  owner: string;
  canonicalRef: string;
  commitSha: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  chunkType: CanonicalChunkType;
  symbolName: string | null;
  chunkText: string;
  contentHash: string;
  embeddingModel: string;
};

// ── Search result types ───────────────────────────────────────────────────────

/**
 * Result from a semantic or full-text search over canonical chunks.
 * Includes provenance fields so callers know exactly where the chunk comes from.
 */
export type CanonicalChunkSearchResult = {
  id: bigint;
  repo: string;
  owner: string;
  canonicalRef: string;
  commitSha: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  chunkType: CanonicalChunkType;
  symbolName: string | null;
  chunkText: string;
  contentHash: string;
  /** Cosine distance [0, 1) for embedding search; rank-derived score for full-text. */
  distance: number;
  embeddingModel: string | null;
};

// ── Backfill state ────────────────────────────────────────────────────────────

export type BackfillStatus = "running" | "completed" | "failed" | "partial";

export type CanonicalCorpusBackfillState = {
  repo: string;
  owner: string;
  canonicalRef: string;
  runId: string;
  status: BackfillStatus;
  filesTotal: number | null;
  filesDone: number;
  chunksTotal: number | null;
  chunksDone: number;
  chunksSkipped: number;
  chunksFailed: number;
  lastFilePath: string | null;
  commitSha: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── Store contract ────────────────────────────────────────────────────────────

/**
 * Store interface for the canonical current-code corpus.
 *
 * All methods operate on `canonical_code_chunks` and
 * `canonical_corpus_backfill_state` (migration 033).
 *
 * Separation guarantee: this store MUST NOT touch historical snippet tables
 * (code_snippets, code_snippet_occurrences).
 */
export type CanonicalCodeStore = {
  /**
   * Upsert a canonical chunk and its embedding.
   *
   * Uses the chunk identity (repo, owner, canonical_ref, file_path,
   * chunk_type, symbol_name) as the conflict key. If the content_hash
   * matches the existing row, the row is left untouched (dedup).
   * If content_hash differs, the row is replaced with the new text and
   * embedding.
   *
   * Returns 'inserted' | 'replaced' | 'dedup' to let callers track
   * backfill / update progress accurately.
   */
  upsertChunk(
    input: CanonicalChunkWriteInput,
    embedding: Float32Array,
  ): Promise<"inserted" | "replaced" | "dedup">;

  /**
   * Soft-delete all chunks for a specific file.
   * Called before re-ingesting a changed file so that stale symbol-level
   * rows are removed rather than left as orphans.
   */
  deleteChunksForFile(params: {
    repo: string;
    owner: string;
    canonicalRef: string;
    filePath: string;
  }): Promise<number>;

  /**
   * Semantic similarity search over active canonical chunks.
   * Results are scoped to a specific repo + ref.
   */
  searchByEmbedding(params: {
    queryEmbedding: Float32Array;
    repo: string;
    canonicalRef: string;
    topK: number;
    language?: string;
    distanceThreshold?: number;
  }): Promise<CanonicalChunkSearchResult[]>;

  /**
   * Full-text search over active canonical chunks.
   */
  searchByFullText(params: {
    query: string;
    repo: string;
    canonicalRef: string;
    topK: number;
    language?: string;
  }): Promise<CanonicalChunkSearchResult[]>;

  /**
   * Count active (non-deleted) chunks for a repo + ref.
   * Useful for audit and backfill progress reporting.
   */
  countChunks(params: {
    repo: string;
    canonicalRef: string;
  }): Promise<number>;

  /**
   * List active (non-deleted) chunk identities for a specific file.
   * Used by the steady-state update path to delete only removed identities.
   */
  listChunksForFile(params: {
    repo: string;
    owner: string;
    canonicalRef: string;
    filePath: string;
  }): Promise<Array<Pick<CanonicalCodeChunk, "id" | "filePath" | "chunkType" | "symbolName" | "contentHash">>>;

  /**
   * Read chunks that need re-embedding (stale=true or model mismatch).
   * Used by the repair/audit pipeline.
   */
  listStaleChunks(params: {
    repo: string;
    canonicalRef: string;
    targetModel: string;
    limit: number;
  }): Promise<CanonicalCodeChunk[]>;

  /**
   * Mark a chunk as stale (triggers re-embedding on next repair pass).
   */
  markStale(ids: bigint[]): Promise<void>;

  /**
   * Batch-update embeddings for a set of chunk IDs.
   * Called by the repair pipeline.
   */
  updateEmbeddingsBatch(payload: {
    embeddings: Array<{ id: bigint; embedding: Float32Array }>;
    targetModel: string;
  }): Promise<void>;

  // ── Backfill state ────────────────────────────────────────────────────────

  getBackfillState(params: {
    repo: string;
    owner: string;
    canonicalRef: string;
  }): Promise<CanonicalCorpusBackfillState | null>;

  saveBackfillState(state: CanonicalCorpusBackfillState): Promise<void>;

  close(): void;
};
