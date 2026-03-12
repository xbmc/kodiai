import type { Logger } from "pino";
import type { EmbeddingProvider, EmbeddingResult } from "./types.ts";

// ── Voyage AI REST API types ────────────────────────────────────────────────

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_CONTEXTUALIZED_URL = "https://api.voyageai.com/v1/contextualized-embeddings";

interface VoyageEmbedResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
  model?: string;
  usage?: { total_tokens: number };
}

interface VoyageContextualizedResponse {
  data?: Array<{
    data?: Array<{ embedding?: number[]; index?: number }>;
  }>;
  model?: string;
  usage?: { total_tokens: number };
}

/**
 * Make a Voyage AI API request with retry and timeout.
 */
async function voyageFetch<T>(opts: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  maxRetries: number;
  logger: Logger;
}): Promise<T | null> {
  const { url, apiKey, body, timeoutMs, maxRetries, logger } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        if (attempt < maxRetries) {
          logger.debug({ status: response.status, attempt }, "Voyage API error, retrying");
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        logger.warn({ status: response.status, text: text.slice(0, 200) }, "Voyage API request failed");
        return null;
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timer);
      if (attempt < maxRetries) {
        logger.debug({ attempt, err: String(err) }, "Voyage API error, retrying");
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      logger.warn({ err: String(err) }, "Voyage API request failed after retries");
      return null;
    }
  }
  return null;
}

// ── Providers ───────────────────────────────────────────────────────────────

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
 * Uses direct fetch instead of the VoyageAI SDK for Bun compatibility.
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

  return {
    async generate(text: string, inputType: "document" | "query"): Promise<EmbeddingResult> {
      const response = await voyageFetch<VoyageEmbedResponse>({
        url: VOYAGE_API_URL,
        apiKey,
        body: {
          input: [text],
          model,
          input_type: inputType,
          output_dimension: dimensions,
        },
        timeoutMs: 30_000,
        maxRetries: 2,
        logger,
      });

      const embedding = response?.data?.[0]?.embedding;
      if (!embedding) {
        if (response !== null) {
          logger.warn({ model }, "Embedding response missing data (fail-open)");
        }
        return null;
      }

      return {
        embedding: new Float32Array(embedding),
        model,
        dimensions,
      };
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
 * Uses direct fetch instead of the VoyageAI SDK for Bun compatibility.
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

  return {
    async generate(text: string, inputType: "document" | "query"): Promise<EmbeddingResult> {
      const response = await voyageFetch<VoyageContextualizedResponse>({
        url: VOYAGE_CONTEXTUALIZED_URL,
        apiKey,
        body: {
          inputs: [[text]],
          model,
          input_type: inputType,
          output_dimension: dimensions,
        },
        timeoutMs: 30_000,
        maxRetries: 2,
        logger,
      });

      const embedding = response?.data?.[0]?.data?.[0]?.embedding;
      if (!embedding) {
        if (response !== null) {
          logger.warn({ model }, "Contextualized embedding response missing data (fail-open)");
        }
        return null;
      }

      return {
        embedding: new Float32Array(embedding),
        model,
        dimensions,
      };
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
 * Sends all chunks as one document so the API can see shared document context.
 *
 * Returns a Map from chunk index to Float32Array embedding.
 * Fail-open: returns empty Map on error.
 */
export async function contextualizedEmbedChunks(opts: {
  apiKey: string;
  chunks: string[];
  model: string;
  dimensions: number;
  logger: Logger;
}): Promise<Map<number, Float32Array>> {
  const { apiKey, chunks, model, dimensions, logger } = opts;
  const result = new Map<number, Float32Array>();

  if (chunks.length === 0) return result;

  const response = await voyageFetch<VoyageContextualizedResponse>({
    url: VOYAGE_CONTEXTUALIZED_URL,
    apiKey,
    body: {
      inputs: [chunks],
      model,
      input_type: "document",
      output_dimension: dimensions,
    },
    timeoutMs: 60_000,
    maxRetries: 2,
    logger,
  });

  const docData = response?.data?.[0]?.data;
  if (!docData) {
    if (response !== null) {
      logger.warn({ model, chunkCount: chunks.length }, "Contextualized batch embedding response missing data (fail-open)");
    }
    return result;
  }

  for (const item of docData) {
    if (item.index !== undefined && item.embedding) {
      result.set(item.index, new Float32Array(item.embedding));
    }
  }

  return result;
}
