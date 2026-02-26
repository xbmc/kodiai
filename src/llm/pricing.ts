/**
 * Pricing configuration loader and cost estimation.
 *
 * Pricing data is loaded from pricing.json (not hardcoded in source).
 * This allows updating prices without code changes.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Pricing for a single model. */
export type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

/** Full pricing configuration. */
export type PricingConfig = {
  lastUpdated: string;
  models: Record<string, ModelPricing>;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedPricing: PricingConfig | null = null;

/**
 * Loads pricing configuration from pricing.json.
 * Caches the result after first load.
 * Logs a warning if lastUpdated is more than 30 days old.
 */
export function loadPricing(): PricingConfig {
  if (cachedPricing) return cachedPricing;

  const pricingPath = join(__dirname, "pricing.json");
  // Use require-style import for JSON (sync)
  const data = require(pricingPath) as PricingConfig;

  // Check staleness
  const lastUpdated = new Date(data.lastUpdated);
  const daysSinceUpdate = Math.floor(
    (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysSinceUpdate > 30) {
    console.warn(
      `[pricing] pricing.json is ${daysSinceUpdate} days old (last updated: ${data.lastUpdated}). Consider updating.`,
    );
  }

  cachedPricing = data;
  return data;
}

/**
 * Returns pricing for a specific model, or null if not found.
 */
export function getModelPricing(model: string): ModelPricing | null {
  const config = loadPricing();
  return config.models[model] ?? null;
}

/**
 * Computes estimated USD cost for a given model and token usage.
 * Returns 0 if model is not found in pricing config (fail-open).
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}
