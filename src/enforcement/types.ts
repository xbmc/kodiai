import type { FindingSeverity, FindingCategory } from "../knowledge/types.ts";

/**
 * Defines a pattern for severity floor enforcement.
 * Keywords use OR-of-AND groups: at least one group must have all keywords present.
 */
export type SeverityPattern = {
  id: string;
  language: string;
  keywords: string[][];
  minSeverity: FindingSeverity;
  category?: FindingCategory;
  contextRelaxation?: {
    testFiles: boolean;
    relaxedSeverity?: FindingSeverity;
  };
  description: string;
};

/**
 * Result of workspace scanning for formatter/linter config files.
 */
export type DetectedTooling = {
  formatters: Map<string, string[]>;
  linters: Map<string, string[]>;
};

/**
 * Extends the finding concept with enforcement metadata.
 * Applied after severity floor enforcement and tooling suppression.
 */
export type EnforcedFinding = {
  originalSeverity: FindingSeverity;
  severity: FindingSeverity;
  severityElevated: boolean;
  enforcementPatternId?: string;
  toolingSuppressed: boolean;
};

/**
 * User-facing config type for the languageRules section in .kodiai.yml.
 * Matches the shape produced by the Zod schema in config.ts.
 */
export type LanguageRulesConfig = {
  severityFloors: Array<{
    pattern: string;
    language?: string;
    minSeverity: FindingSeverity;
    skipTestFiles: boolean;
  }>;
  toolingOverrides: Array<{
    language: string;
    suppressFormatting: boolean;
    suppressImportOrder: boolean;
    configFiles?: string[];
  }>;
  disableBuiltinFloors: boolean;
};
