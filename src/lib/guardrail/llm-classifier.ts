// ---------------------------------------------------------------------------
// LLM Fallback Classifier for Ambiguous Claims
// ---------------------------------------------------------------------------
// Uses Haiku via generateWithFallback to classify claims that the rule-based
// classifier can't confidently decide. Batches claims into chunks of 10 for
// a single LLM call per batch.
// ---------------------------------------------------------------------------

import type { ClaimClassification, ClaimLabel, GroundingContext } from "./types.ts";
import type { TaskRouter } from "../../llm/task-router.ts";
import type { GenerateResult } from "../../llm/generate.ts";
import { TASK_TYPES } from "../../llm/task-types.ts";
import type { Logger } from "pino";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LlmClassifierClaim = {
  text: string;
  context: GroundingContext;
};

export type LlmClassifier = (
  claims: LlmClassifierClaim[],
) => Promise<ClaimClassification[]>;

export type LlmClassifierDeps = {
  generateWithFallback: (opts: {
    taskType: string;
    resolved: ReturnType<TaskRouter["resolve"]>;
    prompt: string;
    system?: string;
    logger: Logger;
    repo?: string;
    deliveryId?: string;
  }) => Promise<GenerateResult>;
  taskRouter: TaskRouter;
  costTracker?: unknown;
  repo: string;
  deliveryId?: string;
  logger: Logger;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CLAIMS_PER_BATCH = 10;

const SYSTEM_PROMPT =
  "You are a claim grounding classifier. For each claim, determine if it is supported by the provided context or requires external knowledge. Respond with JSON only.";

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildBatchPrompt(claims: LlmClassifierClaim[]): string {
  const sections = claims.map((claim, i) => {
    const contextText = claim.context.providedContext.length > 0
      ? claim.context.providedContext.join("\n")
      : "(no context provided)";

    return [
      `### Claim ${i + 1}`,
      `Text: "${claim.text}"`,
      `Context sources: ${claim.context.contextSources.join(", ") || "none"}`,
      `Available context:`,
      contextText,
    ].join("\n");
  });

  return [
    "Classify each of the following claims. For each claim, determine whether it is:",
    '- "diff-grounded": directly supported by the provided context',
    '- "external-knowledge": asserts facts not present in the provided context (versions, dates, API behavior, CVEs)',
    '- "inferential": a logical deduction from the provided context',
    "",
    ...sections,
    "",
    `Respond with a JSON array of exactly ${claims.length} objects, each with:`,
    '- "label": one of "diff-grounded", "external-knowledge", "inferential"',
    '- "confidence": number between 0.0 and 1.0',
    '- "evidence": brief explanation of classification',
    "",
    "Respond with JSON only, no markdown code fences.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

type RawClassification = {
  label?: string;
  confidence?: number;
  evidence?: string;
};

const VALID_LABELS = new Set<ClaimLabel>(["diff-grounded", "external-knowledge", "inferential"]);

function parseClassifications(
  text: string,
  claimTexts: string[],
): ClaimClassification[] {
  // Try to extract JSON from the response (handle markdown fences)
  let jsonText = text.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }

  const parsed: RawClassification[] = JSON.parse(jsonText);

  if (!Array.isArray(parsed)) {
    throw new Error("Response is not a JSON array");
  }

  // Map parsed results to ClaimClassification, padding if needed
  return claimTexts.map((text, i) => {
    const raw = parsed[i];
    if (!raw || !VALID_LABELS.has(raw.label as ClaimLabel)) {
      return failOpenClassification(text);
    }
    return {
      text,
      label: raw.label as ClaimLabel,
      confidence: typeof raw.confidence === "number" ? raw.confidence : 0.7,
      evidence: raw.evidence ?? "LLM classification",
    };
  });
}

function failOpenClassification(text: string): ClaimClassification {
  return {
    text,
    label: "diff-grounded",
    confidence: 0.5,
    evidence: "LLM classification fail-open: defaulting to grounded",
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an LLM classifier that batches ambiguous claims into Haiku calls.
 *
 * Fail-open: on any LLM error or parse failure, returns all claims as
 * "diff-grounded" with confidence 0.5.
 */
export function createLlmClassifier(deps: LlmClassifierDeps): LlmClassifier {
  const { generateWithFallback, taskRouter, repo, deliveryId, logger } = deps;

  return async (claims: LlmClassifierClaim[]): Promise<ClaimClassification[]> => {
    if (claims.length === 0) return [];

    try {
      const resolved = taskRouter.resolve(TASK_TYPES.GUARDRAIL_CLASSIFICATION);

      // Batch claims into chunks of MAX_CLAIMS_PER_BATCH
      const results: ClaimClassification[] = [];
      for (let i = 0; i < claims.length; i += MAX_CLAIMS_PER_BATCH) {
        const batch = claims.slice(i, i + MAX_CLAIMS_PER_BATCH);
        const batchTexts = batch.map((c) => c.text);

        try {
          const prompt = buildBatchPrompt(batch);
          const response = await generateWithFallback({
            taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
            resolved,
            prompt,
            system: SYSTEM_PROMPT,
            logger,
            repo,
            deliveryId,
          });

          const classifications = parseClassifications(response.text, batchTexts);
          results.push(...classifications);
        } catch (batchErr) {
          // Fail-open per batch: if one batch fails, return all claims in that batch as grounded
          logger.warn(
            { err: batchErr, batchSize: batch.length },
            "LLM classifier batch failed, applying fail-open for batch",
          );
          results.push(...batchTexts.map(failOpenClassification));
        }
      }

      return results;
    } catch (err) {
      // Global fail-open: return all claims as grounded
      logger.warn(
        { err },
        "LLM classifier failed globally, applying fail-open for all claims",
      );
      return claims.map((c) => failOpenClassification(c.text));
    }
  };
}
