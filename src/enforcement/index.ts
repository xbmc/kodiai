/**
 * Enforcement module public API.
 *
 * Re-exports all enforcement functions and types, plus provides the
 * convenience `applyEnforcement` orchestrator that runs the full
 * detect -> suppress -> floor pipeline in correct order.
 */

// Types
export type {
  SeverityPattern,
  DetectedTooling,
  EnforcedFinding,
  LanguageRulesConfig,
} from "./types.ts";

// Tooling detection
export {
  detectRepoTooling,
  FORMATTER_CONFIGS,
  LINTER_CONFIGS,
} from "./tooling-detection.ts";

// Severity floors
export {
  enforceSeverityFloors,
  BUILTIN_SEVERITY_PATTERNS,
  matchesPattern,
  severityRank,
} from "./severity-floors.ts";

// Tooling suppression
export {
  suppressToolingFindings,
  FORMATTING_KEYWORDS,
  IMPORT_ORDER_KEYWORDS,
} from "./tooling-suppression.ts";

// Diff grounding
export {
  enforceDiffGrounding,
  buildDiffGroundingIndex,
  isDiffTruncated,
  DIFF_GROUNDING_DOWNGRADE_TARGET,
} from "./diff-grounding.ts";
export type { DiffGroundingReasonCode, DiffGroundingResult } from "./diff-grounding.ts";

// Semantic grounding
export {
  enforceSemanticGrounding,
  buildSemanticGroundingSourceIndex,
  SEMANTIC_GROUNDING_DOWNGRADE_TARGET,
} from "./semantic-grounding.ts";
export type {
  SemanticGroundingReasonCode,
  SemanticGroundingResult,
  SemanticGroundingLLM,
  SemanticGroundingOptions,
} from "./semantic-grounding.ts";

import type { Logger } from "pino";
import type { FindingSeverity } from "../knowledge/types.ts";
import type { LanguageRulesConfig, EnforcedFinding } from "./types.ts";
import { detectRepoTooling } from "./tooling-detection.ts";
import { suppressToolingFindings } from "./tooling-suppression.ts";
import { enforceSeverityFloors } from "./severity-floors.ts";
import { enforceDiffGrounding, buildDiffGroundingIndex, isDiffTruncated, type DiffGroundingResult } from "./diff-grounding.ts";
import {
  enforceSemanticGrounding,
  buildSemanticGroundingSourceIndex,
  type SemanticGroundingLLM,
  type SemanticGroundingOptions,
  type SemanticGroundingResult,
} from "./semantic-grounding.ts";

/**
 * Minimum shape required by the enforcement pipeline.
 * Compatible with ExtractedFinding from review.ts without creating
 * a hard import dependency.
 */
type EnforcementFinding = {
  filePath: string;
  title: string;
  severity: FindingSeverity;
  category: string;
  [key: string]: unknown;
};

/**
 * Orchestrate the full enforcement pipeline:
 *   1. Detect repo tooling (filesystem scan)
 *   2. Suppress tooling-covered findings
 *   3. Enforce severity floors
 *   4. Ground critical/major file:line citations against the collected diff
 *   5. Semantically re-verify critical/major findings that survived step 4
 *      (opt-in, LLM-backed; no-op unless a `semanticGroundingLLM` and
 *      `semanticGroundingOptions.enabled: true` are supplied)
 *
 * Fail-open: any error in enforcement logs a warning and returns
 * findings unchanged with default enforcement metadata.
 */
export async function applyEnforcement(params: {
  findings: EnforcementFinding[];
  workspaceDir: string;
  filesByCategory: Record<string, string[]>;
  filesByLanguage: Record<string, string[]>;
  languageRules?: LanguageRulesConfig;
  /** Raw unified diff text collected for this review, used to ground file:line citations. */
  diffText?: string | null;
  /**
   * Optional LLM used for the semantic grounding re-verification pass (step
   * 5). When omitted or when `semanticGroundingOptions.enabled` is not
   * true, the step is a no-op passthrough -- semantic grounding is opt-in.
   */
  semanticGroundingLLM?: SemanticGroundingLLM | null;
  semanticGroundingOptions?: SemanticGroundingOptions;
  logger?: Logger | { warn: (obj: unknown, msg: string) => void; info?: (obj: unknown, msg: string) => void };
}): Promise<(EnforcementFinding & EnforcedFinding & DiffGroundingResult & SemanticGroundingResult)[]> {
  try {
    // Step 1: Detect repo tooling (filesystem scan)
    const detectedTooling = await detectRepoTooling(params.workspaceDir, params.logger);

    // Step 2: Suppress tooling-covered findings
    const afterTooling = suppressToolingFindings({
      findings: params.findings,
      detectedTooling,
      languageRules: params.languageRules,
    });

    // Step 3: Enforce severity floors
    // Cast needed: suppressToolingFindings preserves severity as string in its
    // generic return type, but we know inputs had FindingSeverity values.
    const enforced = enforceSeverityFloors({
      findings: afterTooling as (typeof afterTooling[number] & { severity: FindingSeverity })[],
      filesByCategory: params.filesByCategory,
      filesByLanguage: params.filesByLanguage,
      languageRules: params.languageRules,
    });

    // Merge toolingSuppressed from step 2 back into step 3 results.
    // enforceSeverityFloors always sets toolingSuppressed: false because it
    // operates independently; we restore the actual suppression state here.
    const merged = enforced.map((finding, i) => ({
      ...finding,
      toolingSuppressed: afterTooling[i]?.toolingSuppressed ?? false,
    }));

    // Step 4: Ground critical/major citations against the collected diff.
    // Runs last so a hallucinated line reference can pull an elevated
    // severity back down; it never re-elevates.
    // Parsing the diff is the expensive part of this gate, so skip it entirely
    // when nothing is gated: only critical/major findings are ever checked, and
    // most reviews carry none. Passing an empty index makes enforceDiffGrounding
    // fail open, which is the same result those findings would have reached.
    const needsDiffGrounding = merged.some((finding) =>
      finding.severity === "critical" || finding.severity === "major"
    );
    const diffLineIndex = needsDiffGrounding
      ? buildDiffGroundingIndex(params.diffText)
      : new Map();
    const grounded = enforceDiffGrounding({
      diffTruncated: needsDiffGrounding && isDiffTruncated(params.diffText),
      findings: merged as (typeof merged[number] & { severity: FindingSeverity })[],
      diffLineIndex,
    });

    // Step 5: Semantically re-verify critical/major findings that survived
    // structural diff grounding. Opt-in (no-op passthrough when no LLM is
    // supplied) and bounded (at most a handful of LLM calls per review --
    // see semantic-grounding.ts for the cap). Runs last for the same reason
    // as step 4: it can only pull an already-elevated severity back down,
    // never re-elevate.
    const semanticGroundingEnabled = (params.semanticGroundingOptions?.enabled ?? false) && !!params.semanticGroundingLLM;
    const sourceIndex = semanticGroundingEnabled
      ? buildSemanticGroundingSourceIndex(params.diffText)
      : new Map();
    const semanticallyGrounded = await enforceSemanticGrounding({
      findings: grounded as (typeof grounded[number] & { severity: FindingSeverity })[],
      sourceIndex,
      llm: params.semanticGroundingLLM,
      options: params.semanticGroundingOptions,
      logger: params.logger,
    });

    return semanticallyGrounded as (EnforcementFinding & EnforcedFinding & DiffGroundingResult & SemanticGroundingResult)[];
  } catch (err) {
    // Fail-open: log warning, return findings unchanged with default metadata
    params.logger?.warn(
      { err },
      "Enforcement pipeline failed (fail-open, returning findings unchanged)",
    );
    return params.findings.map((f) => ({
      ...f,
      originalSeverity: f.severity,
      severityElevated: false,
      toolingSuppressed: false,
      groundingChecked: false,
      groundingVerified: true,
      groundingDowngraded: false,
      groundingReason: "no-diff-available" as const,
      semanticGroundingChecked: false,
      semanticGroundingDowngraded: false,
      semanticGroundingReason: "disabled" as const,
    }));
  }
}
