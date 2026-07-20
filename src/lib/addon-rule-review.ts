import type { Logger } from "pino";
import { mapWithConcurrency } from "./concurrency.ts";
import { createTaskRouter } from "../llm/task-router.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import { generateWithFallback } from "../llm/generate.ts";
import type { PullRequestFileMetadata } from "./github-pr-files.ts";
import {
  collectAddonRuleContext,
  type AddonRuleAddonContext,
} from "./addon-rule-context.ts";
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
type GenerateAddonRuleChunk = (params: AddonRuleLlmInput) => Promise<string>;

export const MAX_ADDON_RULE_LLM_CHUNK_PATCH_CHARS = 60_000;
const ADDON_RULE_LLM_CHUNK_CONCURRENCY = 3;
const MAX_AGGREGATED_ADDON_RULE_FINDINGS = 20;

export async function runDefaultAddonRuleLlm(
  input: AddonRuleLlmInput,
  logger: Logger,
  generateChunkForTests?: GenerateAddonRuleChunk,
): Promise<AddonRuleLlmResult> {
  const chunks = chunkAddonRuleContexts(input.contexts);
  const generateChunk = generateChunkForTests ?? createDefaultChunkGenerator(logger);
  const chunkResults = await mapWithConcurrency(
    chunks,
    ADDON_RULE_LLM_CHUNK_CONCURRENCY,
    async (contexts, chunkIndex) => {
      const chunkInput = { ...input, contexts };
      try {
        const text = await generateChunk(chunkInput);
        return parseAddonRuleReviewOutput(text, contexts);
      } catch (err) {
        logger.warn(
          { err, chunkIndex: chunkIndex + 1, chunkCount: chunks.length },
          "Addon rule model chunk failed",
        );
        return { findings: [], rejectedOutput: true } satisfies AddonRuleLlmResult;
      }
    },
  );
  return aggregateAddonRuleChunkResults(input, chunks.length, chunkResults);
}

function createDefaultChunkGenerator(logger: Logger): GenerateAddonRuleChunk {
  const taskRouter = createTaskRouter({ models: {} });
  const resolved = taskRouter.resolve(TASK_TYPES.GUARDRAIL_CLASSIFICATION);
  return async (input) => {
    const result = await generateWithFallback({
      taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
      resolved,
      prompt: buildAddonRuleReviewPrompt(input),
      system: "Review only supplied Kodi addon diff evidence for submission-rule compliance. Return only the requested JSON.",
      logger,
      repo: input.repo,
    });
    return result.text;
  };
}

function chunkAddonRuleContexts(
  contexts: readonly AddonRuleLlmInput["contexts"][number][],
): AddonRuleLlmInput["contexts"][] {
  const chunks: AddonRuleAddonContext[][] = [];
  let current = new Map<string, AddonRuleAddonContext>();
  let currentPatchChars = 0;

  const flush = () => {
    if (current.size === 0) return;
    chunks.push([...current.values()]);
    current = new Map();
    currentPatchChars = 0;
  };

  for (const context of contexts) {
    for (const file of context.files) {
      const patchChars = file.patch?.length ?? 0;
      if (currentPatchChars > 0
        && patchChars > 0
        && currentPatchChars + patchChars > MAX_ADDON_RULE_LLM_CHUNK_PATCH_CHARS) {
        flush();
      }

      const chunkContext = current.get(context.addonId) ?? {
        addonId: context.addonId,
        allChangedPaths: [...context.allChangedPaths],
        files: [],
      };
      chunkContext.files.push(file);
      current.set(context.addonId, chunkContext);
      currentPatchChars += patchChars;
    }
  }
  flush();
  return chunks;
}

function aggregateAddonRuleChunkResults(
  input: AddonRuleLlmInput,
  chunkCount: number,
  results: readonly AddonRuleLlmResult[],
): AddonRuleLlmResult {
  const findings = results.flatMap((result) => result.findings);
  const rejectedSummary = results.some((result) => result.rejectedSummary);
  let rejectedOutput = results.some((result) => result.rejectedOutput);
  if (findings.length > MAX_AGGREGATED_ADDON_RULE_FINDINGS) rejectedOutput = true;

  const result: AddonRuleLlmResult = {
    findings: findings.slice(0, MAX_AGGREGATED_ADDON_RULE_FINDINGS),
  };
  if (chunkCount === 1) {
    result.summary = results[0]?.summary;
  } else if (chunkCount > 1) {
    result.summary = buildChunkedSummary(input, chunkCount, results);
  }
  if (rejectedSummary) result.rejectedSummary = true;
  if (rejectedOutput) result.rejectedOutput = true;
  return result;
}

function buildChunkedSummary(
  input: AddonRuleLlmInput,
  chunkCount: number,
  results: readonly AddonRuleLlmResult[],
): string {
  const addonCount = input.contexts.length;
  const patchCount = input.contexts.reduce(
    (count, context) => count + context.files.filter((file) => file.patch !== undefined).length,
    0,
  );
  const base = `Reviewed ${addonCount} changed ${addonCount === 1 ? "addon" : "addons"} on \`${input.baseBranch}\` across ${patchCount} scoped ${patchCount === 1 ? "patch" : "patches"} in ${chunkCount} evidence chunks.`;
  const summaries = [...new Set(results.flatMap((result) => result.summary ? [result.summary] : []))];
  let summary = base;
  for (const candidate of summaries) {
    if (summary.length + candidate.length + 1 > 600) break;
    summary += ` ${candidate}`;
  }
  return summary;
}

export async function runAddonRuleReview(params: {
  repo: string;
  prNumber: number;
  baseBranch: string;
  validBranches: readonly string[];
  files: readonly PullRequestFileMetadata[];
  runLlmReview?: boolean;
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
  if (scopedPatchCount > 0 && params.runLlmReview !== false) {
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
    const key = `${finding.addonId}|${finding.path ?? ""}|${finding.line ?? ""}|${finding.rule}|${finding.level}|${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function projectRuleSource(source: AddonRuleSource): AddonRuleReviewComment["rulesSource"] {
  return { kind: source.kind, url: source.url };
}
