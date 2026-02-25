/**
 * Deduplication for retrieval chunks using Jaccard similarity on tokenized text.
 *
 * Dedup targets near-identical chunks (copy-paste, reformatted same content).
 * Uses token-level Jaccard similarity rather than embedding cosine similarity
 * to avoid additional API calls. Threshold of 0.90 catches text-level duplicates
 * without collapsing merely related content.
 */

import type { UnifiedRetrievalChunk } from "./cross-corpus-rrf.ts";

/**
 * Compute Jaccard similarity between two sets of whitespace-tokenized words.
 * Returns a value in [0, 1] where 1 = identical token sets.
 */
export function jaccardSimilarity(textA: string, textB: string): number {
  const tokensA = new Set(textA.toLowerCase().split(/\s+/).filter(Boolean));
  const tokensB = new Set(textB.toLowerCase().split(/\s+/).filter(Boolean));

  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection++;
    }
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplicate retrieval chunks by collapsing near-duplicates.
 *
 * Algorithm:
 * 1. Sort by rrfScore descending (best first)
 * 2. For each chunk, compare against previously kept chunks
 * 3. If Jaccard >= threshold with any kept chunk: skip, annotate kept chunk
 * 4. Return kept chunks in score order
 *
 * Per CONTEXT.md: "When duplicates found: keep the highest-ranked chunk
 * (pure quality wins, source type irrelevant)."
 *
 * @param mode - "within-corpus": dedup within each source before RRF
 *               "cross-corpus": dedup across all sources after RRF
 */
export function deduplicateChunks(params: {
  chunks: UnifiedRetrievalChunk[];
  similarityThreshold?: number;
  mode: "within-corpus" | "cross-corpus";
}): UnifiedRetrievalChunk[] {
  const { chunks, similarityThreshold = 0.9, mode } = params;

  if (chunks.length <= 1) return chunks;

  // Sort by rrfScore descending (best first = kept first)
  const sorted = [...chunks].sort((a, b) => b.rrfScore - a.rrfScore);

  if (mode === "within-corpus") {
    return deduplicateWithinCorpus(sorted, similarityThreshold);
  }
  return deduplicateCrossCorpus(sorted, similarityThreshold);
}

function deduplicateWithinCorpus(
  sorted: UnifiedRetrievalChunk[],
  threshold: number,
): UnifiedRetrievalChunk[] {
  // Group by source, dedup within each group, then recombine
  const bySource = new Map<string, UnifiedRetrievalChunk[]>();
  for (const chunk of sorted) {
    const group = bySource.get(chunk.source) ?? [];
    group.push(chunk);
    bySource.set(chunk.source, group);
  }

  const results: UnifiedRetrievalChunk[] = [];
  for (const group of bySource.values()) {
    results.push(...dedupGroup(group, threshold));
  }

  // Re-sort by rrfScore after combining
  results.sort((a, b) => b.rrfScore - a.rrfScore);
  return results;
}

function deduplicateCrossCorpus(
  sorted: UnifiedRetrievalChunk[],
  threshold: number,
): UnifiedRetrievalChunk[] {
  return dedupGroup(sorted, threshold);
}

function dedupGroup(
  sorted: UnifiedRetrievalChunk[],
  threshold: number,
): UnifiedRetrievalChunk[] {
  const kept: UnifiedRetrievalChunk[] = [];

  for (const candidate of sorted) {
    let isDuplicate = false;

    for (const existing of kept) {
      const similarity = jaccardSimilarity(candidate.text, existing.text);
      if (similarity >= threshold) {
        // Annotate the surviving chunk with the duplicate's source
        if (!existing.alternateSources) {
          existing.alternateSources = [];
        }
        const altLabel = candidate.sourceLabel;
        if (!existing.alternateSources.includes(altLabel)) {
          existing.alternateSources.push(altLabel);
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push({ ...candidate });
    }
  }

  return kept;
}
