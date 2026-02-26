/**
 * Provider model factory for AI SDK instances.
 *
 * Maps model ID strings to AI SDK provider model instances.
 * Supports Anthropic, OpenAI, and Google providers.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { Logger } from "pino";

/**
 * Extracts the provider name from a model ID string.
 *
 * @example
 * extractProvider("claude-sonnet-4-20250514") // "anthropic"
 * extractProvider("gpt-4o-mini") // "openai"
 * extractProvider("gemini-2.0-flash") // "google"
 * extractProvider("openai/gpt-4o") // "openai"
 */
export function extractProvider(modelId: string): string {
  // Check explicit provider prefix (e.g., "anthropic/claude-sonnet-4")
  if (modelId.startsWith("anthropic/")) return "anthropic";
  if (modelId.startsWith("openai/")) return "openai";
  if (modelId.startsWith("google/")) return "google";

  // Check model name patterns
  if (modelId.startsWith("claude-")) return "anthropic";
  if (
    modelId.startsWith("gpt-") ||
    modelId.startsWith("o3-") ||
    modelId.startsWith("o4-")
  )
    return "openai";
  if (modelId.startsWith("gemini-")) return "google";

  // Default to anthropic (existing default provider)
  return "anthropic";
}

/**
 * Strips provider prefix from a model ID if present.
 *
 * @example
 * stripProviderPrefix("anthropic/claude-sonnet-4-20250514") // "claude-sonnet-4-20250514"
 * stripProviderPrefix("gpt-4o-mini") // "gpt-4o-mini"
 */
function stripProviderPrefix(modelId: string): string {
  const prefixes = ["anthropic/", "openai/", "google/"];
  for (const prefix of prefixes) {
    if (modelId.startsWith(prefix)) {
      return modelId.slice(prefix.length);
    }
  }
  return modelId;
}

/**
 * Creates an AI SDK provider model instance from a model ID string.
 *
 * Routes to the correct provider based on model ID prefix or name pattern.
 * Default provider is Anthropic.
 */
export function createProviderModel(modelId: string): LanguageModel {
  const provider = extractProvider(modelId);
  const strippedId = stripProviderPrefix(modelId);

  switch (provider) {
    case "openai":
      return openai(strippedId);
    case "google":
      return google(strippedId);
    case "anthropic":
    default:
      return anthropic(strippedId);
  }
}

/**
 * Validates that required API keys are set for all referenced providers.
 * Logs a warning (does not crash) for missing keys.
 */
export function validateProviderKeys(
  modelIds: string[],
  logger: Logger,
): void {
  const providers = new Set(modelIds.map(extractProvider));

  const envVarMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
  };

  for (const provider of providers) {
    const envVar = envVarMap[provider];
    if (envVar && !process.env[envVar]) {
      logger.warn(
        { provider, envVar },
        `Missing API key for provider %s: set %s environment variable`,
        provider,
        envVar,
      );
    }
  }
}
