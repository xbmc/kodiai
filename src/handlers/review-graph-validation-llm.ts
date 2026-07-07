import type { Logger } from "pino";
import { TASK_TYPES } from "../llm/task-types.ts";
import type { ResolvedModel, TaskRouterConfig } from "../llm/task-router.ts";

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

type GraphValidationLLM = {
  generate(prompt: string, system: string): Promise<string>;
};

export function resolveReviewGraphValidationLLM(params: {
  enabled: boolean;
  hasGraphBlastRadius: boolean;
  repo: string;
  deliveryId: string;
  logger: Logger;
  createTaskRouter?: (config: TaskRouterConfig) => TaskRouter;
  generateWithFallback?: GenerateWithFallback;
}): GraphValidationLLM | null {
  if (!params.enabled || !params.hasGraphBlastRadius) {
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
