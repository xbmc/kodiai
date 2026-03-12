import type { Logger } from "pino";
import type { EmbeddingProvider, EmbeddingResult } from "./types.ts";

// ── Voyage AI REST API types ────────────────────────────────────────────────

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_CONTEXTUALIZED_URL = "https://api.voyageai.com/v1/contextualizedembeddings";

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

export type RepairEmbeddingFailureClass =
  | "request_too_large"
  | "timeout_transient"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "unauthorized"
  | "provider_error"
  | "response_missing_data";

export type ClassifiedContextualizedEmbeddingBatchResult =
  | {
      status: "ok";
      embeddings: Map<number, Float32Array>;
      retry_count: number;
    }
  | {
      status: "failed";
      failure_class: RepairEmbeddingFailureClass;
      message: string;
      retryable: boolean;
      should_split: boolean;
      retry_count: number;
      http_status?: number;
    };

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

function classifyContextualizedEmbeddingFailure(params: {
  status?: number;
  error?: unknown;
  responseBody?: string;
}): {
  failure_class: RepairEmbeddingFailureClass;
  retryable: boolean;
  should_split: boolean;
  message: string;
} {
  const body = (params.responseBody ?? "").toLowerCase();
  const errorMessage = params.error instanceof Error ? params.error.message : String(params.error ?? "");
  const message = errorMessage || params.responseBody || `Voyage request failed${params.status ? ` (${params.status})` : ""}`;

  if (params.status === 401 || params.status === 403) {
    return { failure_class: "unauthorized", retryable: false, should_split: false, message };
  }
  if (params.status === 408 || body.includes("timeout") || errorMessage.toLowerCase().includes("timeout") || errorMessage.toLowerCase().includes("abort")) {
    return { failure_class: "timeout_transient", retryable: true, should_split: false, message };
  }
  if (params.status === 429) {
    return { failure_class: "rate_limited", retryable: true, should_split: false, message };
  }
  if (params.status && params.status >= 500) {
    return { failure_class: "server_error", retryable: true, should_split: false, message };
  }
  if (params.status === 400 || params.status === 413 || body.includes("too large") || body.includes("token") || body.includes("context length") || body.includes("maximum context")) {
    return { failure_class: "request_too_large", retryable: false, should_split: true, message };
  }
  if (params.error) {
    return { failure_class: "network_error", retryable: true, should_split: false, message };
  }
  return { failure_class: "provider_error", retryable: false, should_split: false, message };
}

export async function contextualizedEmbedChunksForRepair(opts: {
  apiKey: string;
  chunks: string[];
  model: string;
  dimensions: number;
  logger: Logger;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<ClassifiedContextualizedEmbeddingBatchResult> {
  const { apiKey, chunks, model, dimensions, logger } = opts;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRetries = opts.maxRetries ?? 0;

  if (chunks.length === 0) {
    return { status: "ok", embeddings: new Map(), retry_count: 0 };
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(VOYAGE_CONTEXTUALIZED_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: [chunks],
          model,
          input_type: "document",
          output_dimension: dimensions,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        const classified = classifyContextualizedEmbeddingFailure({ status: response.status, responseBody });
        if (classified.retryable && attempt < maxRetries) {
          logger.debug({ attempt, status: response.status, failureClass: classified.failure_class }, "Repair embedding request failed, retrying");
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return {
          status: "failed",
          failure_class: classified.failure_class,
          message: classified.message,
          retryable: classified.retryable,
          should_split: classified.should_split,
          retry_count: attempt,
          http_status: response.status,
        };
      }

      const payload = await response.json() as VoyageContextualizedResponse;
      const docData = payload.data?.[0]?.data;
      if (!docData) {
        return {
          status: "failed",
          failure_class: "response_missing_data",
          message: "Contextualized embedding response missing data",
          retryable: false,
          should_split: false,
          retry_count: attempt,
        };
      }

      const embeddings = new Map<number, Float32Array>();
      for (const item of docData) {
        if (item.index !== undefined && item.embedding) {
          embeddings.set(item.index, new Float32Array(item.embedding));
        }
      }

      if (embeddings.size !== chunks.length) {
        return {
          status: "failed",
          failure_class: "response_missing_data",
          message: `Contextualized embedding response returned ${embeddings.size}/${chunks.length} embeddings`,
          retryable: false,
          should_split: false,
          retry_count: attempt,
        };
      }

      return {
        status: "ok",
        embeddings,
        retry_count: attempt,
      };
    } catch (error: unknown) {
      clearTimeout(timer);
      const classified = classifyContextualizedEmbeddingFailure({ error });
      if (classified.retryable && attempt < maxRetries) {
        logger.debug({ attempt, failureClass: classified.failure_class, err: String(error) }, "Repair embedding request threw, retrying");
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return {
        status: "failed",
        failure_class: classified.failure_class,
        message: classified.message,
        retryable: classified.retryable,
        should_split: classified.should_split,
        retry_count: attempt,
      };
    }
  }

  return {
    status: "failed",
    failure_class: "provider_error",
    message: "Repair embedding request exhausted without a classified result",
    retryable: false,
    should_split: false,
    retry_count: maxRetries,
  };
}
