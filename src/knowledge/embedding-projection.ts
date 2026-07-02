/**
 * Deterministic feature-hash projection for bounding pairwise embedding work.
 *
 * This preserves a stable, approximate distance space for clustering while
 * callers keep original-dimension embeddings for persisted centroids.
 */
export function projectEmbeddingByFeatureHash(
  embedding: Float32Array,
  maxDimensions: number,
): Float32Array {
  if (embedding.length <= maxDimensions) return embedding;

  const projected = new Float32Array(maxDimensions);
  for (let i = 0; i < embedding.length; i++) {
    const bucket = i % maxDimensions;
    const sign = ((i / maxDimensions) | 0) % 2 === 0 ? 1 : -1;
    projected[bucket] = projected[bucket]! + embedding[i]! * sign;
  }

  const scale = Math.sqrt(Math.ceil(embedding.length / maxDimensions));
  if (scale > 1) {
    for (let i = 0; i < projected.length; i++) {
      projected[i] = projected[i]! / scale;
    }
  }

  return projected;
}
