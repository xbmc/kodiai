/**
 * validation.ts
 *
 * Optional second-pass validation for graph-amplified findings.
 *
 * When the review graph surfaces impacted files that differ from the directly
 * changed files, findings on those graph-amplified files carry inherent
 * uncertainty — the LLM may have over-extrapolated from structural signals.
 * This module provides an optional validation pass that asks a lightweight
 * model to confirm whether each graph-amplified finding is plausibly relevant
 * given the change context.
 *
 * Design invariants:
 * - **Fail-open.** Any error in the validation pipeline returns the original
 *   findings unmodified. Review completion is never blocked.
 * - **Configurable.** Validation only runs when `enabled: true`. When
 *   disabled, the function is a no-op identity transform.
 * - **Non-destructive.** The function only adds metadata (`graphValidated`,
 *   `graphValidationVerdict`) to each finding — it never removes findings.
 *   Callers choose how to act on verdicts.
 * - **Graph-scoped.** Only findings on graph-amplified files (files present in
 *   `impactedFiles` or `probableDependents` but NOT in the changed-file set)
 *   are validated. Findings on directly changed files pass through unchanged.
 */

import type { Logger } from "pino";
import type { ReviewGraphBlastRadiusResult } from "./query.ts";

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/** Verdict returned by the validation pass for a single finding. */
export type GraphValidationVerdict = "confirmed" | "uncertain" | "skipped";

/** Input finding shape — a subset of handler ProcessedFinding fields. */
export type GraphValidationFinding = {
  /** Unique identifier for the finding (e.g. comment ID). */
  id: number | string;
  /** File path the finding applies to. */
  filePath: string;
  /** Finding title for context. */
  title: string;
  /** Finding severity for context. */
  severity: string;
};

/** Output finding shape — original fields plus validation metadata. */
export type ValidatedFinding<T extends GraphValidationFinding> = T & {
  /** Whether this finding was subjected to graph validation. */
  graphValidated: boolean;
  /** Verdict from the validation pass. `"skipped"` when not graph-amplified. */
  graphValidationVerdict: GraphValidationVerdict;
};

/** Options for the validation pass. */
export type GraphValidationOptions = {
  /** Whether validation is enabled. Default: false (bypass). */
  enabled?: boolean;
  /**
   * Maximum number of findings to validate per call.
   * Prevents unbounded LLM use on very large reviews.
   * Default: 10.
   */
  maxFindingsToValidate?: number;
  /**
   * Character budget for the change-context summary injected into the
   * validation prompt. Default: 1000.
   */
  contextMaxChars?: number;
};

/** LLM generation interface used by the validation pass. */
export type ValidationLLM = {
  generate(prompt: string, system: string): Promise<string>;
};

/** Result from `validateGraphAmplifiedFindings`. */
export type GraphValidationResult<T extends GraphValidationFinding> = {
  findings: ValidatedFinding<T>[];
  /** Number of findings that were subjected to LLM validation. */
  validatedCount: number;
  /** Number of findings validated as "confirmed". */
  confirmedCount: number;
  /** Number of findings validated as "uncertain". */
  uncertainCount: number;
  /** Whether the validation pipeline ran without errors. */
  succeeded: boolean;
  /** Error message when `succeeded` is false (validation bypassed, findings unmodified). */
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_MAX_FINDINGS = 10;
const DEFAULT_CONTEXT_MAX_CHARS = 1000;

/**
 * Determine which files are graph-amplified (present in blast radius but
 * NOT in the set of directly changed files).
 */
function buildAmplifiedFileSet(blastRadius: ReviewGraphBlastRadiusResult): Set<string> {
  const changedSet = new Set(blastRadius.changedFiles);
  const amplified = new Set<string>();

  for (const file of blastRadius.impactedFiles) {
    if (!changedSet.has(file.path)) {
      amplified.add(file.path);
    }
  }

  for (const dep of blastRadius.probableDependents) {
    if (!changedSet.has(dep.filePath)) {
      amplified.add(dep.filePath);
    }
  }

  for (const test of blastRadius.likelyTests) {
    if (!changedSet.has(test.path)) {
      amplified.add(test.path);
    }
  }

  return amplified;
}

/**
 * Build a concise change-context summary from the blast radius result for
 * injection into the validation prompt.
 */
function buildChangeContext(
  blastRadius: ReviewGraphBlastRadiusResult,
  maxChars: number,
): string {
  const parts: string[] = [];

  parts.push(`Changed files (${blastRadius.changedFiles.length}):`);
  for (const f of blastRadius.changedFiles.slice(0, 10)) {
    parts.push(`  - ${f}`);
  }

  const summary = parts.join("\n");
  if (summary.length <= maxChars) return summary;
  return summary.slice(0, maxChars).trimEnd() + "\n...[truncated]";
}

/**
 * Build the validation prompt for a batch of findings.
 */
function buildValidationPrompt(params: {
  findings: GraphValidationFinding[];
  changeContext: string;
}): string {
  const findingLines = params.findings.map((f, i) => {
    return `${i + 1}. [${f.severity.toUpperCase()}] "${f.title}" in \`${f.filePath}\``;
  });

  return [
    "The following code review findings were flagged on files that are INDIRECTLY impacted by a code change (graph-amplified files, not directly modified).",
    "",
    "Change context:",
    params.changeContext,
    "",
    "Findings to evaluate:",
    ...findingLines,
    "",
    "For each finding, reply with the finding number and a single word verdict: CONFIRMED (the finding is plausibly relevant given the change) or UNCERTAIN (the finding may be unrelated to this change).",
    "",
    "Format your response as:",
    "1: CONFIRMED",
    "2: UNCERTAIN",
    "etc.",
    "",
    "Be concise. Only output the numbered verdicts.",
  ].join("\n");
}

/**
 * Parse LLM validation response into a map from finding index (1-based) to verdict.
 */
function parseValidationResponse(
  response: string,
  findingCount: number,
): Map<number, GraphValidationVerdict> {
  const verdicts = new Map<number, GraphValidationVerdict>();

  for (const line of response.split("\n")) {
    const match = line.match(/^\s*(\d+)\s*:\s*(CONFIRMED|UNCERTAIN)\s*$/i);
    if (!match) continue;
    const idx = parseInt(match[1]!, 10);
    const raw = match[2]!.toUpperCase();
    if (idx < 1 || idx > findingCount) continue;
    verdicts.set(idx, raw === "CONFIRMED" ? "confirmed" : "uncertain");
  }

  return verdicts;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the optional second-pass validation pass for graph-amplified findings.
 *
 * - When `options.enabled` is false (default), all findings are returned
 *   with `graphValidated: false, graphValidationVerdict: "skipped"`.
 * - When `blastRadius` is null, behaves as if disabled.
 * - All errors are caught and the original findings are returned with
 *   `succeeded: false` and `graphValidated: false`.
 *
 * @param findings   Findings from the review pass.
 * @param blastRadius Blast-radius result from the graph query (or null).
 * @param llm        LLM interface for the validation call (or null to skip).
 * @param options    Validation options.
 * @param logger     Pino logger.
 */
export async function validateGraphAmplifiedFindings<T extends GraphValidationFinding>(
  findings: T[],
  blastRadius: ReviewGraphBlastRadiusResult | null | undefined,
  llm: ValidationLLM | null | undefined,
  options: GraphValidationOptions = {},
  logger: Logger,
): Promise<GraphValidationResult<T>> {
  const enabled = options.enabled ?? false;
  const maxFindings = options.maxFindingsToValidate ?? DEFAULT_MAX_FINDINGS;
  const contextMaxChars = options.contextMaxChars ?? DEFAULT_CONTEXT_MAX_CHARS;

  // Annotate all findings with passthrough metadata (no validation).
  const passthrough = (succeeded: boolean, err?: unknown): GraphValidationResult<T> => {
    const errorMessage = err instanceof Error ? err.message : String(err ?? "");
    return {
      findings: findings.map((f) => ({
        ...f,
        graphValidated: false,
        graphValidationVerdict: "skipped" as GraphValidationVerdict,
      })),
      validatedCount: 0,
      confirmedCount: 0,
      uncertainCount: 0,
      succeeded,
      errorMessage: succeeded ? undefined : errorMessage,
    };
  };

  if (!enabled || !blastRadius || !llm) {
    return passthrough(true);
  }

  try {
    const amplifiedFiles = buildAmplifiedFileSet(blastRadius);

    if (amplifiedFiles.size === 0) {
      // No graph-amplified files — nothing to validate.
      return passthrough(true);
    }

    // Partition findings into graph-amplified vs directly-changed.
    const amplifiedFindings: Array<{ finding: T; originalIndex: number }> = [];
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i]!;
      if (amplifiedFiles.has(f.filePath)) {
        amplifiedFindings.push({ finding: f, originalIndex: i });
      }
    }

    if (amplifiedFindings.length === 0) {
      return passthrough(true);
    }

    // Cap to maxFindingsToValidate.
    const toValidate = amplifiedFindings.slice(0, maxFindings);

    logger.info(
      {
        gate: "graph-validation",
        totalFindings: findings.length,
        amplifiedFileCount: amplifiedFiles.size,
        amplifiedFindingCount: amplifiedFindings.length,
        validatingCount: toValidate.length,
        capped: amplifiedFindings.length > maxFindings,
      },
      "Running graph-amplified finding validation",
    );

    const changeContext = buildChangeContext(blastRadius, contextMaxChars);
    const prompt = buildValidationPrompt({
      findings: toValidate.map((x) => x.finding),
      changeContext,
    });

    const system =
      "You are a code-review quality assistant. Evaluate whether code review findings on indirectly impacted files are plausibly relevant to the described change. Be conservative — when uncertain, say UNCERTAIN.";

    let responseText: string;
    try {
      responseText = await llm.generate(prompt, system);
    } catch (llmErr) {
      logger.warn(
        { gate: "graph-validation", err: llmErr },
        "Graph validation LLM call failed (fail-open, skipping validation)",
      );
      return passthrough(false, llmErr);
    }

    const verdicts = parseValidationResponse(responseText, toValidate.length);

    // Build output findings with validation metadata merged in.
    const resultFindings: ValidatedFinding<T>[] = findings.map((f, globalIdx) => {
      const amplifiedEntry = toValidate.find((x) => x.originalIndex === globalIdx);
      if (!amplifiedEntry) {
        // Not graph-amplified — pass through.
        return { ...f, graphValidated: false, graphValidationVerdict: "skipped" as GraphValidationVerdict };
      }

      // Find position in toValidate for verdict lookup (1-based).
      const pos = toValidate.indexOf(amplifiedEntry) + 1;
      const verdict: GraphValidationVerdict = verdicts.get(pos) ?? "uncertain";

      return { ...f, graphValidated: true, graphValidationVerdict: verdict };
    });

    // Findings from amplifiedFindings that exceeded maxFindings also get skipped.
    // (They're already in the passthrough set, but let's mark them explicitly.)
    for (let i = maxFindings; i < amplifiedFindings.length; i++) {
      const entry = amplifiedFindings[i]!;
      const existing = resultFindings[entry.originalIndex];
      if (existing && !existing.graphValidated) {
        resultFindings[entry.originalIndex] = {
          ...existing,
          graphValidated: false,
          graphValidationVerdict: "skipped",
        };
      }
    }

    const confirmedCount = [...verdicts.values()].filter((v) => v === "confirmed").length;
    const uncertainCount = [...verdicts.values()].filter((v) => v === "uncertain").length;

    logger.info(
      {
        gate: "graph-validation",
        validatedCount: toValidate.length,
        confirmedCount,
        uncertainCount,
        verdictsParsed: verdicts.size,
      },
      "Graph-amplified finding validation complete",
    );

    return {
      findings: resultFindings,
      validatedCount: toValidate.length,
      confirmedCount,
      uncertainCount,
      succeeded: true,
    };
  } catch (err) {
    logger.warn(
      { gate: "graph-validation", err },
      "Graph-amplified finding validation failed (fail-open, returning original findings)",
    );
    return passthrough(false, err);
  }
}

// ---------------------------------------------------------------------------
// Trivial-change bypass helpers
// ---------------------------------------------------------------------------

/**
 * Options for the trivial-change bypass check.
 */
export type TrivialBypassOptions = {
  /**
   * File count threshold below which graph overhead is bypassed.
   * Default: 3.
   */
  trivialFileThreshold?: number;
  /**
   * Line-change threshold below which graph overhead is bypassed.
   * Combined with file threshold using OR (either condition alone triggers bypass).
   * Default: 0 (disabled — only file count is used by default).
   */
  trivialLineThreshold?: number;
};

/**
 * Determine whether the graph query should be bypassed for a trivial change.
 *
 * Returns `true` when the change is small enough that graph overhead is not
 * worth running. The caller should skip the graph query and leave
 * `graphBlastRadius` as null when this returns true.
 *
 * Design: fail-closed — returns `false` (do not bypass) on any unexpected
 * input, so the graph query runs when uncertain.
 */
export function isTrivialChange(params: {
  changedFileCount: number;
  totalLinesChanged?: number;
  options?: TrivialBypassOptions;
}): { bypass: boolean; reason: string } {
  const { changedFileCount, totalLinesChanged = 0 } = params;
  const opts = params.options ?? {};
  const fileThreshold = opts.trivialFileThreshold ?? 3;
  const lineThreshold = opts.trivialLineThreshold ?? 0;

  if (changedFileCount <= 0) {
    return { bypass: false, reason: "no-files" };
  }

  if (changedFileCount <= fileThreshold) {
    return {
      bypass: true,
      reason: `file-count-${changedFileCount}-lte-threshold-${fileThreshold}`,
    };
  }

  if (lineThreshold > 0 && totalLinesChanged > 0 && totalLinesChanged <= lineThreshold) {
    return {
      bypass: true,
      reason: `lines-changed-${totalLinesChanged}-lte-threshold-${lineThreshold}`,
    };
  }

  return { bypass: false, reason: "non-trivial" };
}
