import { VoyageAIClient, VoyageAIError } from "voyageai";
import type { Logger } from "pino";
import type { EmbeddingProvider, EmbeddingResult } from "./types.ts";

// Re-export VoyageAIClient for direct SDK use in backfill scripts
export { VoyageAIClient } from "voyageai";

/**
 * Create a no-op embedding provider that always returns null.
 * Used when embeddings are disabled or API key is missing.
 */
export function createNoOpEmbeddingProvider(logger: Logger): EmbeddingProvider {
  logger.info("Embedding provider disabled -- using no-op provider (all generate calls return null)");
  return {
    async generate(_text: string, _inputType: "document" | "query"): Promise<EmbeddingResult> {
      return null;
    },
    get model() {
      return "none";
    },
    get dimensions() {
      return 0;
    },
  };
}

/**
 * Create a Voyage AI embedding provider with fail-open semantics.
 * On any error (API failure, timeout, etc.), returns null instead of throwing.
 */
export function createEmbeddingProvider(opts: {
  apiKey: string;
  model: string;
  dimensions: number;
  logger: Logger;
}): EmbeddingProvider {
  const { apiKey, model, dimensions, logger } = opts;

  if (!apiKey) {
    return createNoOpEmbeddingProvider(logger);
  }

  const client = new VoyageAIClient({ apiKey });

  return {
    async generate(text: string, inputType: "document" | "query"): Promise<EmbeddingResult> {
      try {
        const response = await client.embed(
          {
            input: text,
            model,
            inputType,
            outputDimension: dimensions,
          },
          {
            timeoutInSeconds: 10,
            maxRetries: 2,
          },
        );

        if (!response.data?.[0]?.embedding) {
          logger.warn({ model }, "Embedding response missing data (fail-open)");
          return null;
        }

        return {
          embedding: new Float32Array(response.data[0].embedding),
          model,
          dimensions,
        };
      } catch (err: unknown) {
        if (err instanceof VoyageAIError) {
          logger.warn(
            { statusCode: err.statusCode, message: err.message },
            "Voyage AI embedding generation failed (fail-open)",
          );
        } else {
          logger.warn({ err }, "Embedding generation failed (fail-open)");
        }
        return null;
      }
    },
    get model() {
      return model;
    },
    get dimensions() {
      return dimensions;
    },
  };
}

/**
 * Create a Voyage AI contextualized embedding provider with fail-open semantics.
 * Uses `contextualizedEmbed()` instead of `embed()` for document-aware chunk embeddings.
 * On any error (API failure, timeout, etc.), returns null instead of throwing.
 */
export function createContextualizedEmbeddingProvider(opts: {
  apiKey: string;
  model: string;
  dimensions: number;
  logger: Logger;
}): EmbeddingProvider {
  const { apiKey, model, dimensions, logger } = opts;

  if (!apiKey) {
    return createNoOpEmbeddingProvider(logger);
  }

  const client = new VoyageAIClient({ apiKey });

  return {
    async generate(text: string, inputType: "document" | "query"): Promise<EmbeddingResult> {
      try {
        const response = await client.contextualizedEmbed(
          {
            inputs: [[text]],
            model,
            inputType,
            outputDimension: dimensions,
          },
          {
            timeoutInSeconds: 10,
            maxRetries: 2,
          },
        );

        const embedding = response.data?.[0]?.data?.[0]?.embedding;
        if (!embedding) {
          logger.warn({ model }, "Contextualized embedding response missing data (fail-open)");
          return null;
        }

        return {
          embedding: new Float32Array(embedding),
          model,
          dimensions,
        };
      } catch (err: unknown) {
        if (err instanceof VoyageAIError) {
          logger.warn(
            { statusCode: err.statusCode, message: err.message },
            "Voyage AI contextualized embedding generation failed (fail-open)",
          );
        } else {
          logger.warn({ err }, "Contextualized embedding generation failed (fail-open)");
        }
        return null;
      }
    },
    get model() {
      return model;
    },
    get dimensions() {
      return dimensions;
    },
  };
}

/**
 * Batch-embed all chunks of a single document using contextualizedEmbed.
 * Sends all chunks as one document: `inputs: [chunks]` so the API can see
 * shared document context across chunks.
 *
 * Returns a Map from chunk index to Float32Array embedding.
 * Fail-open: returns empty Map on error.
 */
export async function contextualizedEmbedChunks(opts: {
  client: VoyageAIClient;
  chunks: string[];
  model: string;
  dimensions: number;
  logger: Logger;
}): Promise<Map<number, Float32Array>> {
  const { client, chunks, model, dimensions, logger } = opts;
  const result = new Map<number, Float32Array>();

  if (chunks.length === 0) return result;

  try {
    const response = await client.contextualizedEmbed(
      {
        inputs: [chunks],
        model,
        inputType: "document",
        outputDimension: dimensions,
      },
      {
        timeoutInSeconds: 30,
        maxRetries: 2,
      },
    );

    const docData = response.data?.[0]?.data;
    if (!docData) {
      logger.warn({ model, chunkCount: chunks.length }, "Contextualized batch embedding response missing data (fail-open)");
      return result;
    }

    for (const item of docData) {
      if (item.index !== undefined && item.embedding) {
        result.set(item.index, new Float32Array(item.embedding));
      }
    }

    return result;
  } catch (err: unknown) {
    if (err instanceof VoyageAIError) {
      logger.warn(
        { statusCode: err.statusCode, message: err.message, chunkCount: chunks.length },
        "Voyage AI contextualized batch embedding failed (fail-open)",
      );
    } else {
      logger.warn({ err, chunkCount: chunks.length }, "Contextualized batch embedding failed (fail-open)");
    }
    return result;
  }
}
