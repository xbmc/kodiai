import type { Logger } from "pino";
import { createTaskRouter } from "../llm/task-router.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import { generateWithFallback } from "../llm/generate.ts";
import { collectAddonRuleContext } from "./addon-rule-context.ts";
import { runDeterministicAddonRuleChecks } from "./addon-rule-deterministic.ts";
import {
  buildAddonRuleReviewPrompt,
  parseAddonRuleReviewOutput,
  type AddonRuleLlmInput,
} from "./addon-rule-llm.ts";
import {
  loadAddonRuleSource,
  type AddonRuleSource,
} from "./addon-rule-source.ts";
import type { AddonRuleFinding, AddonRuleReviewComment } from "./addon-rule-types.ts";

export type LoadAddonRuleSource = typeof loadAddonRuleSource;
export type RunAddonRuleLlm = (params: AddonRuleLlmInput) => Promise<AddonRuleFinding[]>;

export async function runDefaultAddonRuleLlm(
  input: AddonRuleLlmInput,
  logger: Logger,
): Promise<AddonRuleFinding[]> {
  const taskRouter = createTaskRouter({ models: {} });
  const resolved = taskRouter.resolve(TASK_TYPES.GUARDRAIL_CLASSIFICATION);
  const result = await generateWithFallback({
    taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
    resolved,
    prompt: buildAddonRuleReviewPrompt(input),
    system: "You review Kodi addon submissions for add-on rule compliance. Return only the requested JSON.",
    logger,
    repo: input.repo,
  });
  return parseAddonRuleReviewOutput(result.text);
}

export async function runAddonRuleReview(params: {
  repo: string;
  prNumber: number;
  workspaceDir: string;
  files: Array<{ filename: string }>;
  logger: Logger;
  loadRules?: LoadAddonRuleSource;
  runLlm?: RunAddonRuleLlm;
}): Promise<AddonRuleReviewComment> {
  const loadRules = params.loadRules ?? loadAddonRuleSource;
  const runLlm = params.runLlm ?? ((input) => runDefaultAddonRuleLlm(input, params.logger));
  const [ruleSource, contexts] = await Promise.all([
    loadRules(),
    collectAddonRuleContext({
      workspaceDir: params.workspaceDir,
      files: params.files,
    }),
  ]);

  const deterministicFindings = runDeterministicAddonRuleChecks(contexts);
  let llmFindings: AddonRuleFinding[] = [];
  let incompleteReason: string | undefined;

  if (contexts.some((context) => context.files.some((file) => file.content !== undefined))) {
    try {
      llmFindings = await runLlm({
        repo: params.repo,
        prNumber: params.prNumber,
        rules: ruleSource,
        contexts,
      });
    } catch {
      incompleteReason = "LLM addon-rule review was incomplete; deterministic checks still ran.";
    }
  }

  return {
    rulesSource: projectRuleSource(ruleSource),
    findings: [...deterministicFindings, ...llmFindings],
    ...(incompleteReason ? { incompleteReason } : {}),
  };
}

function projectRuleSource(source: AddonRuleSource): AddonRuleReviewComment["rulesSource"] {
  return { kind: source.kind, url: source.url };
}
