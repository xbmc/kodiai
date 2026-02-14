import type { DetectedTooling, LanguageRulesConfig } from "./types.ts";
import { classifyFileLanguage } from "../execution/diff-analysis.ts";

/**
 * Keyword sets for identifying formatting-related findings.
 * Each inner array is an AND group -- all keywords must be present.
 * Outer array is OR -- at least one group must match.
 */
export const FORMATTING_KEYWORDS: string[][] = [];

/**
 * Keyword sets for identifying import-order-related findings.
 * Same OR-of-AND logic as FORMATTING_KEYWORDS.
 */
export const IMPORT_ORDER_KEYWORDS: string[][] = [];

/**
 * Check if a finding title matches formatting keywords.
 */
export function isFormattingFinding(_title: string): boolean {
  return false;
}

/**
 * Check if a finding title matches import-order keywords.
 */
export function isImportOrderFinding(_title: string): boolean {
  return false;
}

/**
 * Suppress findings that are covered by detected repo tooling.
 */
export function suppressToolingFindings(_params: {
  findings: Array<{ filePath: string; title: string; severity: string; category: string; [key: string]: unknown }>;
  detectedTooling: DetectedTooling;
  languageRules?: LanguageRulesConfig;
}): Array<{ filePath: string; title: string; severity: string; category: string; toolingSuppressed: boolean; [key: string]: unknown }> {
  return [];
}
