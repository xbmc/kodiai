import type { DetectedTooling, LanguageRulesConfig } from "./types.ts";
import { classifyFileLanguage } from "../execution/diff-analysis.ts";

/**
 * Keyword sets for identifying formatting-related findings.
 * Each inner array is an AND group -- all keywords must be present in the title.
 * Outer array is OR -- at least one group must match for the finding to be formatting.
 */
export const FORMATTING_KEYWORDS: string[][] = [
  ["formatting"],
  ["indentation"],
  ["indent"],
  ["trailing", "comma"],
  ["semicolon"],
  ["bracket", "placement"],
  ["brace", "style"],
  ["line", "length"],
  ["whitespace"],
  ["spacing"],
  ["quote", "style"],
  ["tab"],
  ["newline"],
];

/**
 * Keyword sets for identifying import-order-related findings.
 * Same OR-of-AND logic as FORMATTING_KEYWORDS.
 */
export const IMPORT_ORDER_KEYWORDS: string[][] = [
  ["import", "order"],
  ["import", "sort"],
  ["import", "group"],
  ["import", "arrange"],
  ["sorted", "import"],
  ["organize", "import"],
];

/**
 * Categories that can be suppressed by tooling detection.
 * Correctness, security, and performance are NEVER suppressed.
 */
const SUPPRESSABLE_CATEGORIES = new Set(["style", "documentation"]);

/**
 * Check if a normalized title matches a keyword set using OR-of-AND logic.
 * At least one keyword group must have ALL its keywords present in the title.
 */
function matchesKeywordSet(
  normalizedTitle: string,
  keywordSets: string[][],
): boolean {
  return keywordSets.some((group) =>
    group.every((keyword) => normalizedTitle.includes(keyword.toLowerCase())),
  );
}

/**
 * Check if a finding title matches formatting keywords.
 */
export function isFormattingFinding(title: string): boolean {
  const normalized = title.toLowerCase();
  return matchesKeywordSet(normalized, FORMATTING_KEYWORDS);
}

/**
 * Check if a finding title matches import-order keywords.
 */
export function isImportOrderFinding(title: string): boolean {
  const normalized = title.toLowerCase();
  return matchesKeywordSet(normalized, IMPORT_ORDER_KEYWORDS);
}

/**
 * Suppress findings that are covered by detected repo tooling (formatters/linters).
 *
 * Only suppresses formatting and import-order findings in languages where the
 * corresponding tooling config has been detected. Never suppresses correctness,
 * security, or performance findings.
 *
 * User toolingOverrides from .kodiai.yml can disable suppression per language/type.
 */
export function suppressToolingFindings(params: {
  findings: Array<{
    filePath: string;
    title: string;
    severity: string;
    category: string;
    [key: string]: unknown;
  }>;
  detectedTooling: DetectedTooling;
  languageRules?: LanguageRulesConfig;
}): Array<{
  filePath: string;
  title: string;
  severity: string;
  category: string;
  toolingSuppressed: boolean;
  [key: string]: unknown;
}> {
  const { findings, detectedTooling, languageRules } = params;

  // Build a quick lookup map from language -> override for O(1) access
  const overridesByLanguage = new Map<
    string,
    { suppressFormatting: boolean; suppressImportOrder: boolean }
  >();
  if (languageRules?.toolingOverrides) {
    for (const override of languageRules.toolingOverrides) {
      overridesByLanguage.set(override.language, {
        suppressFormatting: override.suppressFormatting,
        suppressImportOrder: override.suppressImportOrder,
      });
    }
  }

  return findings.map((finding) => {
    // Detect language from file path
    const language = classifyFileLanguage(finding.filePath);

    // Category guard: only suppress style and documentation findings
    if (!SUPPRESSABLE_CATEGORIES.has(finding.category)) {
      return { ...finding, toolingSuppressed: false };
    }

    const override = overridesByLanguage.get(language);
    const hasFormatter = detectedTooling.formatters.has(language);
    const hasLinter = detectedTooling.linters.has(language);

    // Check formatting suppression
    if (isFormattingFinding(finding.title)) {
      // User override can explicitly disable formatting suppression
      if (override && override.suppressFormatting === false) {
        return { ...finding, toolingSuppressed: false };
      }
      // Suppress if formatter detected for this language
      if (hasFormatter) {
        return { ...finding, toolingSuppressed: true };
      }
    }

    // Check import-order suppression
    if (isImportOrderFinding(finding.title)) {
      // User override can explicitly disable import-order suppression
      if (override && override.suppressImportOrder === false) {
        return { ...finding, toolingSuppressed: false };
      }
      // Suppress if linter detected for this language
      if (hasLinter) {
        return { ...finding, toolingSuppressed: true };
      }
    }

    // Not a formatting/import-order finding, or no tooling detected -> pass through
    return { ...finding, toolingSuppressed: false };
  });
}
