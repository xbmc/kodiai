/**
 * Task router: resolves a task type string to a concrete model+provider+sdk tuple.
 *
 * Resolution order (per research Pitfall 5):
 * 1. Exact match: config.models["review.full"]
 * 2. Longest prefix wildcard: config.models["review.*"]
 * 3. Category default: agentic -> Agent SDK, non-agentic -> AI SDK
 * 4. Global default: config.defaultModel
 */

import type { Logger } from "pino";
import { isAgenticTaskType } from "./task-types.ts";
import { extractProvider } from "./providers.ts";

/** Result of resolving a task type to a concrete model. */
export interface ResolvedModel {
  /** The model ID to use (e.g., "claude-sonnet-4-5-20250929"). */
  modelId: string;
  /** The provider name (e.g., "anthropic", "openai", "google"). */
  provider: string;
  /** Which SDK to use: "agent" for Agent SDK, "ai" for AI SDK. */
  sdk: "agent" | "ai";
  /** Fallback model ID for when the primary model fails. */
  fallbackModelId: string;
  /** Fallback provider name. */
  fallbackProvider: string;
}

/** Configuration for creating a task router. */
export interface TaskRouterConfig {
  /** Task type to model ID mappings. Supports wildcards like "review.*". */
  models: Record<string, string>;
  /** Global default model. Defaults to claude-sonnet-4-5-20250929. */
  defaultModel?: string;
  /** Default fallback model. Defaults to claude-sonnet-4-5-20250929. */
  defaultFallbackModel?: string;
}

/** Task router instance. */
export interface TaskRouter {
  /** Resolve a task type to a concrete model+provider+sdk tuple. */
  resolve(taskType: string): ResolvedModel;
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_HAIKU_MODEL = "claude-haiku-4-5-20250929";

/**
 * Creates a task router that resolves task types to model configurations.
 */
export function createTaskRouter(
  config: TaskRouterConfig,
  logger?: Logger,
): TaskRouter {
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL;
  const defaultFallbackModel = config.defaultFallbackModel ?? DEFAULT_MODEL;

  return {
    resolve(taskType: string): ResolvedModel {
      const agentic = isAgenticTaskType(taskType);
      let modelId: string | undefined;

      // 1. Exact match
      if (config.models[taskType]) {
        modelId = config.models[taskType];
      }

      // 2. Longest prefix wildcard match
      if (!modelId) {
        let longestMatch = "";
        for (const key of Object.keys(config.models)) {
          if (!key.endsWith(".*")) continue;
          const prefix = key.slice(0, -2); // Remove ".*"
          if (
            taskType.startsWith(prefix + ".") &&
            prefix.length > longestMatch.length
          ) {
            longestMatch = prefix;
            modelId = config.models[key];
          }
        }
      }

      // 3. Category default
      if (!modelId) {
        modelId = agentic ? defaultModel : DEFAULT_HAIKU_MODEL;
      }

      const provider = extractProvider(modelId);
      const fallbackProvider = extractProvider(defaultFallbackModel);

      // Determine SDK
      let sdk: "agent" | "ai";
      if (!agentic) {
        // Non-agentic tasks always use AI SDK
        sdk = "ai";
      } else if (provider === "anthropic") {
        // Agentic tasks with Claude use Agent SDK
        sdk = "agent";
      } else {
        // Agentic tasks routed to non-Claude models: use AI SDK but warn
        sdk = "ai";
        if (logger) {
          logger.warn(
            { taskType, modelId, provider },
            "Agentic task %s routed away from Agent SDK -- MCP tools unavailable",
            taskType,
          );
        }
      }

      return {
        modelId,
        provider,
        sdk,
        fallbackModelId: defaultFallbackModel,
        fallbackProvider,
      };
    },
  };
}
