import type { Logger } from "pino";
import { createTaskRouter } from "../llm/task-router.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import { generateWithFallback } from "../llm/generate.ts";
import type { PullRequestFileMetadata } from "./github-pr-files.ts";
import { collectAddonRuleContext } from "./addon-rule-context.ts";
import { runDeterministicAddonRuleChecks } from "./addon-rule-deterministic.ts";
import {
  buildAddonRuleReviewPrompt,
  parseAddonRuleReviewOutput,
  type AddonRuleLlmInput,
  type AddonRuleLlmResult,
} from "./addon-rule-llm.ts";
import { loadAddonRuleSource, type AddonRuleSource } from "./addon-rule-source.ts";
import type {
  AddonRuleFinding,
  AddonRuleIncompleteReason,
  AddonRuleReviewComment,
} from "./addon-rule-types.ts";

export type LoadAddonRuleSource = typeof loadAddonRuleSource;
export type RunAddonRuleLlm = (params: AddonRuleLlmInput) => Promise<AddonRuleLlmResult>;

export async function runDefaultAddonRuleLlm(
  input: AddonRuleLlmInput,
  logger: Logger,
): Promise<AddonRuleLlmResult> {
  const taskRouter = createTaskRouter({ models: {} });
  const resolved = taskRouter.resolve(TASK_TYPES.GUARDRAIL_CLASSIFICATION);
  const result = await generateWithFallback({
    taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
    resolved,
    prompt: buildAddonRuleReviewPrompt(input),
    system: "Review only supplied Kodi addon diff evidence for submission-rule compliance. Return only the requested JSON.",
    logger,
    repo: input.repo,
  });
  return parseAddonRuleReviewOutput(result.text, input.contexts);
}

export async function runAddonRuleReview(params: {
  repo: string;
  prNumber: number;
  baseBranch: string;
  validBranches: readonly string[];
  files: readonly PullRequestFileMetadata[];
  logger: Logger;
  loadRules?: LoadAddonRuleSource;
  runLlm?: RunAddonRuleLlm;
}): Promise<AddonRuleReviewComment> {
  const loadRules = params.loadRules ?? loadAddonRuleSource;
  const runLlm = params.runLlm ?? ((input) => runDefaultAddonRuleLlm(input, params.logger));
  const ruleSource = await loadRules();
  const contexts = collectAddonRuleContext({ files: params.files });
  const deterministicFindings = runDeterministicAddonRuleChecks({
    baseBranch: params.baseBranch,
    validBranches: params.validBranches,
    contexts,
  });
  const incompleteReasons = collectEvidenceIncompleteReasons(ruleSource, contexts);
  const scopedPatchCount = contexts.reduce(
    (count, context) => count + context.files.filter((file) => file.patch !== undefined).length,
    0,
  );

  let llmResult: AddonRuleLlmResult = { findings: [] };
  if (scopedPatchCount > 0) {
    try {
      llmResult = await runLlm({
        repo: params.repo,
        prNumber: params.prNumber,
        baseBranch: params.baseBranch,
        rules: ruleSource,
        contexts,
      });
      if (!llmResult.summary || llmResult.rejectedSummary || llmResult.rejectedOutput) {
        incompleteReasons.add("llm-incomplete");
      }
    } catch {
      incompleteReasons.add("llm-incomplete");
    }
  }

  return {
    rulesSource: projectRuleSource(ruleSource),
    summary: llmResult.summary ?? deterministicSummary(contexts.length, scopedPatchCount, params.baseBranch),
    findings: dedupeFindings([...deterministicFindings, ...llmResult.findings]),
    incompleteReasons: [...incompleteReasons],
  };
}

function collectEvidenceIncompleteReasons(
  source: AddonRuleSource,
  contexts: ReturnType<typeof collectAddonRuleContext>,
): Set<AddonRuleIncompleteReason> {
  const reasons = new Set<AddonRuleIncompleteReason>();
  if (source.kind === "fallback") reasons.add("rules-fallback");
  for (const context of contexts) {
    for (const file of context.files) {
      if (file.omittedReason === "patch-unavailable") reasons.add("patch-unavailable");
      if (file.omittedReason === "truncated") reasons.add("patch-truncated");
    }
  }
  return reasons;
}

function deterministicSummary(addonCount: number, patchCount: number, baseBranch: string): string {
  const addons = addonCount === 1 ? "addon" : "addons";
  if (patchCount === 0) {
    return `Reviewed ${addonCount} changed ${addons} on \`${baseBranch}\`; no scoped patches were available.`;
  }
  const patches = patchCount === 1 ? "patch" : "patches";
  return `Reviewed ${addonCount} changed ${addons} on \`${baseBranch}\` using ${patchCount} scoped ${patches}.`;
}

function dedupeFindings(findings: readonly AddonRuleFinding[]): AddonRuleFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.addonId}|${finding.path ?? ""}|${finding.rule}|${finding.level}|${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function projectRuleSource(source: AddonRuleSource): AddonRuleReviewComment["rulesSource"] {
  return { kind: source.kind, url: source.url };
}
