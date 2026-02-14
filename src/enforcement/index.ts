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

import type { FindingSeverity } from "../knowledge/types.ts";
import type { LanguageRulesConfig, EnforcedFinding } from "./types.ts";
import { detectRepoTooling } from "./tooling-detection.ts";
import { suppressToolingFindings } from "./tooling-suppression.ts";
import { enforceSeverityFloors } from "./severity-floors.ts";

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
  logger?: { warn: (obj: unknown, msg: string) => void };
}): Promise<(EnforcementFinding & EnforcedFinding)[]> {
  try {
    // Step 1: Detect repo tooling (filesystem scan)
    const detectedTooling = await detectRepoTooling(params.workspaceDir);

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
    return enforced.map((finding, i) => ({
      ...finding,
      toolingSuppressed: afterTooling[i]?.toolingSuppressed ?? false,
    })) as (EnforcementFinding & EnforcedFinding)[];
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
    }));
  }
}
