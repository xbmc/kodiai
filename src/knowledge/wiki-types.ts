/**
 * Type definitions for wiki page storage, chunking, and retrieval.
 */

/** Raw MediaWiki API response fields before chunking. */
export type WikiPageInput = {
  pageId: number;
  pageTitle: string;
  namespace: string;
  pageUrl: string;
  htmlContent: string;
  lastModified?: Date | null;
  revisionId?: number | null;
};

/** The unit stored and embedded: a chunk of a wiki page section. */
export type WikiPageChunk = {
  pageId: number;
  pageTitle: string;
  namespace: string;
  pageUrl: string;
  sectionHeading?: string | null;
  sectionAnchor?: string | null;
  sectionLevel?: number | null;
  chunkIndex: number;
  chunkText: string;
  rawText: string;
  tokenCount: number;
  lastModified?: Date | null;
  revisionId?: number | null;
  embedding?: Float32Array | null;
  /** Language affinity tags derived from page content analysis (e.g. ["python", "javascript"] or ["general"]). */
  languageTags?: string[];
};

/** Full database row type with all columns. */
export type WikiPageRecord = {
  id: number;
  createdAt: string;
  pageId: number;
  pageTitle: string;
  namespace: string;
  pageUrl: string;
  sectionHeading: string | null;
  sectionAnchor: string | null;
  sectionLevel: number | null;
  chunkIndex: number;
  chunkText: string;
  rawText: string;
  tokenCount: number;
  embedding: unknown;
  embeddingModel: string | null;
  stale: boolean;
  lastModified: string | null;
  revisionId: number | null;
  deleted: boolean;
  /** Language affinity tags persisted from detectLanguageTags at ingest time. */
  languageTags: string[];
};

/** Search result with cosine distance score. */
export type WikiPageSearchResult = {
  record: WikiPageRecord;
  distance: number;
};

/** Sync state tracking record for wiki backfill and incremental sync. */
export type WikiSyncState = {
  id?: number;
  source: string;
  lastSyncedAt: Date | null;
  lastContinueToken: string | null;
  totalPagesSynced: number;
  backfillComplete: boolean;
  updatedAt?: string;
};

/** Candidate wiki row eligible for bounded embedding repair. */
export type WikiRepairCandidate = WikiPageRecord;

/** Dedicated durable checkpoint state for wiki embedding repair. */
export type WikiEmbeddingRepairCheckpoint = {
  id?: number;
  repairKey?: string;
  pageId: number | null;
  pageTitle: string | null;
  windowIndex: number | null;
  windowsTotal: number | null;
  repaired: number;
  skipped: number;
  failed: number;
  retryCount: number;
  usedSplitFallback: boolean;
  lastFailureClass: string | null;
  lastFailureMessage: string | null;
  lastProcessedChunkIds?: number[];
  updatedAt?: string;
  createdAt?: string;
};

/** Store interface for wiki page CRUD and search operations. */
export type WikiPageStore = {
  /** Bulk upsert chunks (idempotent: ON CONFLICT DO NOTHING). */
  writeChunks(chunks: WikiPageChunk[]): Promise<void>;

  /** Delete all chunks for a page (for re-chunking on edit). */
  deletePageChunks(pageId: number): Promise<void>;

  /** Atomically replace all chunks for a page (delete + insert in transaction). */
  replacePageChunks(pageId: number, chunks: WikiPageChunk[]): Promise<void>;

  /** Soft-delete all chunks for a page. */
  softDeletePage(pageId: number): Promise<void>;

  /** Vector similarity search with optional namespace filter. */
  searchByEmbedding(params: {
    queryEmbedding: Float32Array;
    topK: number;
    namespace?: string;
  }): Promise<WikiPageSearchResult[]>;

  /** Full-text search using tsvector GIN index. */
  searchByFullText(params: {
    query: string;
    topK: number;
    namespace?: string;
  }): Promise<WikiPageSearchResult[]>;

  /** Get all chunks for a page, ordered by chunk index. */
  getPageChunks(pageId: number): Promise<WikiPageRecord[]>;

  /** Get sync state for a source. */
  getSyncState(source: string): Promise<WikiSyncState | null>;

  /** Upsert sync state for a source. */
  updateSyncState(state: WikiSyncState): Promise<void>;

  /** Count total non-deleted wiki page chunks. */
  countBySource(): Promise<number>;

  /** Get the revision ID for a page (for change detection). */
  getPageRevision(pageId: number): Promise<number | null>;

  /** List degraded rows that need repair, ordered for deterministic bounded processing. */
  listRepairCandidates(params?: {
    pageTitle?: string;
    targetModel?: string;
  }): Promise<WikiRepairCandidate[]>;

  /** Read the dedicated wiki embedding repair checkpoint surface. */
  getRepairCheckpoint(repairKey?: string): Promise<WikiEmbeddingRepairCheckpoint | null>;

  /** Persist the dedicated wiki embedding repair checkpoint surface. */
  saveRepairCheckpoint(state: WikiEmbeddingRepairCheckpoint): Promise<void>;

  /** Batch-update a bounded window of repaired embeddings. */
  writeRepairEmbeddingsBatch(payload: {
    pageId: number;
    pageTitle: string;
    chunkIds: number[];
    targetModel: string;
    embeddings: Array<{ chunkId: number; embedding: Float32Array }>;
  }): Promise<void>;
};
