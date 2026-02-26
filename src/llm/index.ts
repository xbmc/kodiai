/**
 * LLM module barrel exports.
 *
 * Provides task routing, provider management, pricing, and cost tracking
 * for multi-model LLM invocations.
 */

// Task types
export {
  TASK_TYPES,
  type TaskType,
  isAgenticTaskType,
  AGENTIC_TASK_TYPES,
} from "./task-types.ts";

// Task router
export {
  createTaskRouter,
  type ResolvedModel,
  type TaskRouter,
  type TaskRouterConfig,
} from "./task-router.ts";

// Providers
export {
  createProviderModel,
  extractProvider,
  validateProviderKeys,
} from "./providers.ts";

// Pricing
export {
  loadPricing,
  estimateCost,
  getModelPricing,
  type ModelPricing,
  type PricingConfig,
} from "./pricing.ts";

// Cost tracking
export {
  createCostTracker,
  type CostTracker,
  type LlmCostRecord,
} from "./cost-tracker.ts";
