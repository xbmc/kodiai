import type { Logger } from "pino";
import { TASK_TYPES } from "../llm/task-types.ts";
import type { ResolvedModel, TaskRouterConfig } from "../llm/task-router.ts";
import type { SemanticGroundingLLM } from "../enforcement/index.ts";

type TaskRouter = {
  resolve(taskType: string): ResolvedModel;
};

type GenerateWithFallback = (params: {
  taskType: string;
  resolved: ResolvedModel;
  system: string;
  prompt: string;
  logger: Logger;
  repo: string;
  deliveryId: string;
}) => Promise<{ text: string }>;

/**
 * Resolves the LLM used by the semantic grounding re-verification pass
 * (enforcement/semantic-grounding.ts, step 5 of applyEnforcement).
 *
 * Mirrors resolveReviewGraphValidationLLM (review-graph-validation-llm.ts):
 * same cheap `guardrail.classification` task tier, same
 * generate/generateWithFallback plumbing, same repo-config opt-in gate
 * (`review.semanticGrounding.enabled`, default false in .kodiai.yml).
 *
 * Unlike diff-grounding (purely structural, zero-cost), semantic grounding
 * makes a real LLM call per gated finding, so -- exactly like graph
 * validation -- it stays behind an explicit opt-in rather than running
 * unconditionally. This also keeps it a no-op in tests that don't opt in,
 * the same way graph validation's `hasGraphBlastRadius`/`enabled` gate
 * keeps it inert in the existing test suite. Cost stays bounded once
 * enabled because semantic-grounding.ts itself caps how many findings
 * actually trigger an LLM call (`maxFindingsToCheck`, default 5).
 */
export function resolveReviewSemanticGroundingLLM(params: {
  enabled: boolean;
  repo: string;
  deliveryId: string;
  logger: Logger;
  createTaskRouter?: (config: TaskRouterConfig) => TaskRouter;
  generateWithFallback?: GenerateWithFallback;
}): SemanticGroundingLLM | null {
  if (!params.enabled) {
    return null;
  }

  return {
    generate: async (prompt: string, system: string): Promise<string> => {
      const createTaskRouter = params.createTaskRouter
        ?? (await import("../llm/task-router.ts")).createTaskRouter;
      const generateWithFallback = params.generateWithFallback
        ?? (await import("../llm/generate.ts")).generateWithFallback;
      const taskRouter = createTaskRouter({ models: {} });
      const resolved = taskRouter.resolve(TASK_TYPES.GUARDRAIL_CLASSIFICATION);
      const genResult = await generateWithFallback({
        taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
        resolved,
        system,
        prompt,
        logger: params.logger,
        repo: params.repo,
        deliveryId: params.deliveryId,
      });
      return genResult.text;
    },
  };
}
