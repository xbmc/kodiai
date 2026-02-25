/**
 * Cross-corpus Reciprocal Rank Fusion (RRF) engine.
 *
 * Merges ranked lists from heterogeneous knowledge sources (code findings,
 * review comments, wiki pages) into a single unified ranked list using
 * RRF scoring: sum of 1/(k + rank) across all source lists an item appears in.
 */

export type SourceType = "code" | "review_comment" | "wiki";

export type UnifiedRetrievalChunk = {
  /** Unique key for dedup across sources. */
  id: string;
  /** Chunk text content. */
  text: string;
  /** Which corpus this chunk came from. */
  source: SourceType;
  /** Human-readable source label: "[code: file.ts]", "[review: PR #123]", "[wiki: Page Title]" */
  sourceLabel: string;
  /** Clickable URL to the source (GitHub PR URL, wiki page URL, etc.) */
  sourceUrl: string | null;
  /** Original vector distance if available. */
  vectorDistance: number | null;
  /** Computed RRF score (higher is better). */
  rrfScore: number;
  /** Creation/modification date for recency boost. */
  createdAt: string | null;
  /** Corpus-specific metadata preserved for downstream use. */
  metadata: Record<string, unknown>;
  /** Populated by dedup: other sources that had near-duplicate content. */
  alternateSources?: string[];
};

export type RankedSourceList = {
  source: SourceType;
  /** Items pre-sorted best-first (lowest distance / highest relevance). */
  items: UnifiedRetrievalChunk[];
};

/**
 * Merge ranked lists from multiple knowledge corpora using RRF.
 *
 * Algorithm:
 * 1. For each source list, assign RRF score per item: 1/(k + rank)
 * 2. Merge by item id — items in multiple lists get summed scores
 * 3. Apply optional recency boost for recent items
 * 4. Sort by rrfScore descending, return topK
 */
export function crossCorpusRRF(params: {
  sourceLists: RankedSourceList[];
  k?: number;
  topK?: number;
  recencyBoostDays?: number;
  recencyBoostFactor?: number;
  now?: Date;
}): UnifiedRetrievalChunk[] {
  const {
    sourceLists,
    k = 60,
    topK,
    recencyBoostDays = 30,
    recencyBoostFactor = 0.15,
    now = new Date(),
  } = params;

  if (sourceLists.length === 0) return [];

  const merged = new Map<string, UnifiedRetrievalChunk>();

  // Step 1: Score each item by its rank position within each source list
  for (const list of sourceLists) {
    for (let rank = 0; rank < list.items.length; rank++) {
      const item = list.items[rank]!;
      const rrfContribution = 1 / (k + rank);

      const existing = merged.get(item.id);
      if (existing) {
        existing.rrfScore += rrfContribution;
      } else {
        merged.set(item.id, {
          ...item,
          rrfScore: rrfContribution,
        });
      }
    }
  }

  // Step 2: Apply recency boost
  const msPerDay = 86_400_000;
  const boostCutoffMs = recencyBoostDays * msPerDay;

  for (const chunk of merged.values()) {
    if (chunk.createdAt) {
      const created = new Date(chunk.createdAt);
      const ageMs = now.getTime() - created.getTime();
      if (ageMs >= 0 && ageMs <= boostCutoffMs) {
        chunk.rrfScore *= 1 + recencyBoostFactor;
      }
    }
  }

  // Step 3: Sort by rrfScore descending
  const results = Array.from(merged.values()).sort(
    (a, b) => b.rrfScore - a.rrfScore,
  );

  return topK !== undefined ? results.slice(0, topK) : results;
}
