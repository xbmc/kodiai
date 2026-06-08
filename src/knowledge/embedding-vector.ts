export function parsePgVectorEmbedding(raw: unknown): Float32Array | null {
  if (raw instanceof Float32Array) return raw;
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;

  const values = trimmed.slice(1, -1).split(",").map((value) => Number(value.trim()));
  if (values.length === 0 || values.some((value) => Number.isNaN(value))) return null;

  return new Float32Array(values);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function meanEmbedding(embeddings: readonly Float32Array[]): Float32Array | null {
  if (embeddings.length === 0) return new Float32Array(0);

  const dimension = embeddings[0]!.length;
  if (embeddings.some((embedding) => embedding.length !== dimension)) return null;

  const result = new Float32Array(dimension);
  for (const embedding of embeddings) {
    for (let i = 0; i < dimension; i++) {
      result[i]! += embedding[i]!;
    }
  }

  for (let i = 0; i < dimension; i++) {
    result[i]! /= embeddings.length;
  }

  return result;
}
