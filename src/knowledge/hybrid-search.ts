/**
 * Hybrid search combiner: merges vector similarity and BM25 full-text search
 * results per corpus using Reciprocal Rank Fusion (RRF).
 *
 * RRF algorithm (Cormack, Clarke & Butt 2009):
 * For each item at rank position i: score += 1 / (k + i)
 * Items appearing in both lists get summed scores.
 */

export type HybridSearchResult<T> = {
  item: T;
  vectorRank: number | null;
  bm25Rank: number | null;
  hybridScore: number;
};

/**
 * Merge vector and BM25 ranked lists into a single scored list using RRF.
 *
 * @param vectorResults - Results sorted best-first by vector distance (ascending)
 * @param bm25Results - Results sorted best-first by BM25 rank (descending ts_rank)
 * @param getKey - Function to extract a unique key for deduplication
 * @param k - RRF k parameter (default 60, from original RRF paper)
 * @param topK - Maximum results to return
 */
export function hybridSearchMerge<T>(params: {
  vectorResults: T[];
  bm25Results: T[];
  getKey: (item: T) => string;
  k?: number;
  topK?: number;
}): HybridSearchResult<T>[] {
  const { vectorResults, bm25Results, getKey, k = 60, topK } = params;

  if (vectorResults.length === 0 && bm25Results.length === 0) {
    return [];
  }

  const merged = new Map<
    string,
    {
      item: T;
      vectorRank: number | null;
      bm25Rank: number | null;
      hybridScore: number;
    }
  >();

  // Score vector results
  for (let i = 0; i < vectorResults.length; i++) {
    const item = vectorResults[i]!;
    const key = getKey(item);
    const score = 1 / (k + i);

    merged.set(key, {
      item,
      vectorRank: i,
      bm25Rank: null,
      hybridScore: score,
    });
  }

  // Score BM25 results and merge
  for (let i = 0; i < bm25Results.length; i++) {
    const item = bm25Results[i]!;
    const key = getKey(item);
    const score = 1 / (k + i);

    const existing = merged.get(key);
    if (existing) {
      existing.bm25Rank = i;
      existing.hybridScore += score;
    } else {
      merged.set(key, {
        item,
        vectorRank: null,
        bm25Rank: i,
        hybridScore: score,
      });
    }
  }

  // Sort by hybridScore descending and apply topK
  const results = Array.from(merged.values()).sort(
    (a, b) => b.hybridScore - a.hybridScore,
  );

  return topK !== undefined ? results.slice(0, topK) : results;
}
