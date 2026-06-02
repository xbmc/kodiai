import type { EmbeddingProvider } from "./types.ts";

export const DEFAULT_DOCUMENT_EMBEDDING_BATCH_SIZE = 8;

export type DocumentEmbeddingBatchResult =
  | {
    status: "success";
    embedding: Float32Array;
    model: string;
  }
  | {
    status: "unavailable";
    embedding: null;
  }
  | {
    status: "failed";
    embedding: null;
    err: unknown;
  };

type GenerateDocumentEmbeddingsBatchBaseOptions = {
  texts: string[];
  embeddingProvider: Pick<EmbeddingProvider, "generate">;
  batchSize?: number;
};

export async function generateDocumentEmbeddingsBatch(
  opts: GenerateDocumentEmbeddingsBatchBaseOptions & { includeResults: true },
): Promise<DocumentEmbeddingBatchResult[]>;

export async function generateDocumentEmbeddingsBatch(
  opts: GenerateDocumentEmbeddingsBatchBaseOptions & { includeResults?: false },
): Promise<Array<Float32Array | null>>;

export async function generateDocumentEmbeddingsBatch(opts: {
  texts: string[];
  embeddingProvider: Pick<EmbeddingProvider, "generate">;
  batchSize?: number;
  includeResults?: boolean;
}): Promise<Array<Float32Array | null> | DocumentEmbeddingBatchResult[]> {
  const { texts, embeddingProvider } = opts;
  const requestedBatchSize = opts.batchSize ?? DEFAULT_DOCUMENT_EMBEDDING_BATCH_SIZE;
  const batchSize = Number.isFinite(requestedBatchSize)
    ? Math.max(1, Math.floor(requestedBatchSize))
    : DEFAULT_DOCUMENT_EMBEDDING_BATCH_SIZE;
  const results: DocumentEmbeddingBatchResult[] = [];

  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batch = texts.slice(offset, offset + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (text) => {
        try {
          const result = await embeddingProvider.generate(text, "document");
          if (!result) {
            return {
              status: "unavailable",
              embedding: null,
            } satisfies DocumentEmbeddingBatchResult;
          }
          return {
            status: "success",
            embedding: result.embedding,
            model: result.model,
          } satisfies DocumentEmbeddingBatchResult;
        } catch (err) {
          return {
            status: "failed",
            embedding: null,
            err,
          } satisfies DocumentEmbeddingBatchResult;
        }
      }),
    );
    results.push(...batchResults);
  }

  if (opts.includeResults) {
    return results;
  }

  return results.map((result) => result.embedding);
}
