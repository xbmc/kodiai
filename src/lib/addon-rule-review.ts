import type { Logger } from "pino";
import { mapWithConcurrency } from "./concurrency.ts";
import { createTaskRouter } from "../llm/task-router.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import {
  generateStructuredWithFallback,
  StructuredGenerationError,
} from "../llm/structured-generate.ts";
import type { PullRequestFileMetadata } from "./github-pr-files.ts";
import {
  collectAddonRuleContext,
} from "./addon-rule-context.ts";
import { runDeterministicAddonRuleChecks } from "./addon-rule-deterministic.ts";
import {
  packAddonRuleEvidence,
  projectAddonRuleEvidence,
  type AddonRuleEvidenceContext,
} from "./addon-rule-evidence.ts";
import {
  ADDON_RULE_REVIEW_SCHEMA,
  buildAddonRuleReviewPrompt,
  type AddonRuleLlmInput,
  type AddonRuleLlmResult,
  validateAddonRuleReviewOutput,
} from "./addon-rule-llm.ts";
import { loadAddonRuleSource, type AddonRuleSource } from "./addon-rule-source.ts";
import type {
  AddonRuleFinding,
  AddonRuleIncompleteReason,
  AddonRuleReviewComment,
} from "./addon-rule-types.ts";

export type LoadAddonRuleSource = typeof loadAddonRuleSource;
export type RunAddonRuleLlm = (params: AddonRuleLlmInput) => Promise<AddonRuleLlmResult>;
type ReviewStructuredAddonRuleChunk = (params: {
  prompt: string;
  evidence: readonly AddonRuleEvidenceContext[];
  validate: (value: unknown) => AddonRuleLlmResult;
  chunkIndex: number;
  chunkCount: number;
}) => Promise<AddonRuleLlmResult>;

const ADDON_RULE_LLM_CHUNK_CONCURRENCY = 3;
const MAX_AGGREGATED_ADDON_RULE_FINDINGS = 20;

export async function runDefaultAddonRuleLlm(
  input: AddonRuleLlmInput,
  logger: Logger,
  generateChunkForTests?: ReviewStructuredAddonRuleChunk,
): Promise<AddonRuleLlmResult> {
  const projected = projectAddonRuleEvidence(input.contexts);
  const renderPrompt = (contexts: readonly AddonRuleEvidenceContext[]) => (
    buildAddonRuleReviewPrompt(input, contexts)
  );
  const pack = packAddonRuleEvidence(projected, renderPrompt);
  const prompts = pack.chunks.map((evidence) => ({ evidence, prompt: renderPrompt(evidence) }));
  const generateChunk = generateChunkForTests ?? createDefaultChunkGenerator(input, logger);
  logger.info(
    {
      taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
      chunkCount: prompts.length,
      promptChars: prompts.map(({ prompt }) => prompt.length),
      evidenceLineCount: projected.flatMap((context) => context.files).reduce(
        (count, file) => count + file.addedLines.length,
        0,
      ),
      omittedOversizedLines: pack.omittedOversizedLines,
      omittedFiles: pack.omittedFiles,
    },
    "Prepared bounded addon rule model evidence",
  );
  const chunkResults = await mapWithConcurrency(
    prompts,
    ADDON_RULE_LLM_CHUNK_CONCURRENCY,
    ({ evidence, prompt }, chunkIndex) => reviewAddonRuleChunk({
      prompt,
      evidence,
      validate: (value) => validateAddonRuleReviewOutput(value, input.contexts),
      generateChunk,
      logger,
      chunkIndex,
      chunkCount: prompts.length,
    }),
  );
  return aggregateAddonRuleChunkResults(input, prompts.length, chunkResults, {
    omittedFiles: pack.omittedFiles,
    omittedOversizedLines: pack.omittedOversizedLines,
  });
}

async function reviewAddonRuleChunk(params: {
  prompt: string;
  evidence: readonly AddonRuleEvidenceContext[];
  validate: (value: unknown) => AddonRuleLlmResult;
  generateChunk: ReviewStructuredAddonRuleChunk;
  logger: Logger;
  chunkIndex: number;
  chunkCount: number;
}): Promise<AddonRuleLlmResult> {
  const startedAt = Date.now();
  try {
    return await params.generateChunk({
      prompt: params.prompt,
      evidence: params.evidence,
      validate: params.validate,
      chunkIndex: params.chunkIndex,
      chunkCount: params.chunkCount,
    });
  } catch (error) {
    params.logger.warn(
      {
        errorKind: error instanceof StructuredGenerationError ? error.kind : "unknown",
        chunkIndex: params.chunkIndex + 1,
        chunkCount: params.chunkCount,
        durationCategory: categorizeDuration(Date.now() - startedAt),
      },
      "Addon rule model chunk failed",
    );
    return { findings: [], rejectedOutput: true };
  }
}

function createDefaultChunkGenerator(
  input: AddonRuleLlmInput,
  logger: Logger,
): ReviewStructuredAddonRuleChunk {
  const taskRouter = createTaskRouter({ models: {} });
  const resolved = taskRouter.resolve(TASK_TYPES.GUARDRAIL_CLASSIFICATION);
  return async ({ prompt }) => {
    const result = await generateStructuredWithFallback({
      taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
      resolved,
      prompt,
      system: "You classify supplied Kodi add-on diff evidence only for repository submission-rule compliance. Do not perform general code review.",
      schema: ADDON_RULE_REVIEW_SCHEMA,
      validate: (output) => validateAddonRuleReviewOutput(output, input.contexts),
      logger,
      repo: input.repo,
    });
    return result.output;
  };
}

function categorizeDuration(durationMs: number): "under-1s" | "1s-to-10s" | "10s-to-60s" | "over-60s" {
  if (durationMs < 1_000) return "under-1s";
  if (durationMs < 10_000) return "1s-to-10s";
  if (durationMs < 60_000) return "10s-to-60s";
  return "over-60s";
}

function aggregateAddonRuleChunkResults(
  input: AddonRuleLlmInput,
  chunkCount: number,
  results: readonly AddonRuleLlmResult[],
  omissions: { omittedFiles: number; omittedOversizedLines: number },
): AddonRuleLlmResult {
  const findings = results.flatMap((result) => result.findings);
  const rejectedSummary = results.some((result) => result.rejectedSummary);
  let rejectedOutput = results.some((result) => result.rejectedOutput);
  if (findings.length > MAX_AGGREGATED_ADDON_RULE_FINDINGS
    || omissions.omittedFiles > 0
    || omissions.omittedOversizedLines > 0) rejectedOutput = true;

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
