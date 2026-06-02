import type { EmbeddingProvider } from "./types.ts";

export const DEFAULT_DOCUMENT_EMBEDDING_BATCH_SIZE = 8;

export async function generateDocumentEmbeddingsBatch(opts: {
  texts: string[];
  embeddingProvider: Pick<EmbeddingProvider, "generate">;
  batchSize?: number;
}): Promise<Array<Float32Array | null>> {
  const { texts, embeddingProvider } = opts;
  const requestedBatchSize = opts.batchSize ?? DEFAULT_DOCUMENT_EMBEDDING_BATCH_SIZE;
  const batchSize = Number.isFinite(requestedBatchSize)
    ? Math.max(1, Math.floor(requestedBatchSize))
    : DEFAULT_DOCUMENT_EMBEDDING_BATCH_SIZE;
  const embeddings: Array<Float32Array | null> = [];

  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batch = texts.slice(offset, offset + batchSize);
    const batchEmbeddings = await Promise.all(
      batch.map(async (text) => {
        try {
          return (await embeddingProvider.generate(text, "document"))?.embedding ?? null;
        } catch {
          return null;
        }
      }),
    );
    embeddings.push(...batchEmbeddings);
  }

  return embeddings;
}
