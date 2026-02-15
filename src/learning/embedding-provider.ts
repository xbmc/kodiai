import { VoyageAIClient, VoyageAIError } from "voyageai";
import type { Logger } from "pino";
import type { EmbeddingProvider, EmbeddingResult } from "./types.ts";

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
