import type { FindingSeverity } from "../knowledge/types.ts";
import type { SeverityPattern, EnforcedFinding, LanguageRulesConfig } from "./types.ts";
import { classifyFileLanguage } from "../execution/diff-analysis.ts";

/**
 * Checks if a finding title matches a keyword-set pattern.
 * Uses OR-of-AND groups: at least one group must have all its keywords present.
 */
export function matchesPattern(findingTitle: string, keywords: string[][]): boolean {
  const normalized = findingTitle.toLowerCase();
  return keywords.some((group) =>
    group.every((keyword) => normalized.includes(keyword.toLowerCase())),
  );
}

/**
 * Returns a numeric rank for severity ordering.
 * minor=0, medium=1, major=2, critical=3.
 */
const SEVERITY_RANK: Record<FindingSeverity, number> = {
  minor: 0,
  medium: 1,
  major: 2,
  critical: 3,
};

export function severityRank(severity: FindingSeverity): number {
  return SEVERITY_RANK[severity] ?? 0;
}

/**
 * Built-in severity pattern catalog.
 * Seeded from requirements and kodiai PR history analysis.
 * All patterns have contextRelaxation.testFiles=true except sql-injection.
 */
export const BUILTIN_SEVERITY_PATTERNS: SeverityPattern[] = [
  {
    id: "cpp-null-deref",
    language: "C++",
    keywords: [
      ["null", "dereference"],
      ["null", "pointer"],
      ["nullptr"],
      ["npe"],
    ],
    minSeverity: "critical",
    category: "correctness",
    contextRelaxation: { testFiles: true },
    description: "C++ null pointer dereference must be CRITICAL in production code",
  },
  {
    id: "cpp-uninitialized",
    language: "C++",
    keywords: [
      ["uninitialized", "member"],
      ["uninitialized", "variable"],
      ["uninitialized", "field"],
    ],
    minSeverity: "critical",
    category: "correctness",
    contextRelaxation: { testFiles: true },
    description: "C++ uninitialized member/variable must be CRITICAL in production code",
  },
  {
    id: "go-unchecked-error",
    language: "Go",
    keywords: [
      ["unchecked", "error"],
      ["error", "ignored"],
      ["error", "discarded"],
      ["error", "not checked"],
    ],
    minSeverity: "major",
    category: "correctness",
    contextRelaxation: { testFiles: true },
    description: "Go unchecked error returns must be MAJOR in production code",
  },
  {
    id: "python-bare-except",
    language: "Python",
    keywords: [
      ["bare", "except"],
      ["bare", "exception"],
      ["catch-all", "exception"],
    ],
    minSeverity: "major",
    category: "correctness",
    contextRelaxation: { testFiles: true },
    description: "Python bare except clauses must be MAJOR in production code",
  },
  {
    id: "c-null-deref",
    language: "C",
    keywords: [
      ["null", "dereference"],
      ["null", "pointer"],
    ],
    minSeverity: "critical",
    category: "correctness",
    contextRelaxation: { testFiles: true },
    description: "C null pointer dereference must be CRITICAL in production code",
  },
  {
    id: "c-buffer-overflow",
    language: "C",
    keywords: [
      ["buffer", "overflow"],
      ["buffer", "overrun"],
      ["strcpy"],
      ["sprintf"],
    ],
    minSeverity: "critical",
    category: "correctness",
    contextRelaxation: { testFiles: true },
    description: "C buffer overflow patterns must be CRITICAL in production code",
  },
  {
    id: "rust-unwrap",
    language: "Rust",
    keywords: [
      ["unwrap", "panic"],
      ["unwrap", "crash"],
      ["unwrap()", "error"],
    ],
    minSeverity: "major",
    category: "correctness",
    contextRelaxation: { testFiles: true },
    description: "Rust unwrap that may panic must be MAJOR in production code",
  },
  {
    id: "java-unclosed-resource",
    language: "Java",
    keywords: [
      ["unclosed", "resource"],
      ["resource", "leak"],
      ["missing", "close"],
    ],
    minSeverity: "major",
    category: "correctness",
    contextRelaxation: { testFiles: true },
    description: "Java unclosed resource/leak must be MAJOR in production code",
  },
  {
    id: "sql-injection",
    language: "",
    keywords: [
      ["sql", "injection"],
      ["sql", "concatenation"],
    ],
    minSeverity: "critical",
    category: "security",
    contextRelaxation: { testFiles: false },
    description: "SQL injection must be CRITICAL everywhere, including test files",
  },
  {
    id: "ts-unhandled-promise",
    language: "TypeScript",
    keywords: [
      ["unhandled", "promise"],
      ["floating", "promise"],
      ["missing", "await"],
    ],
    minSeverity: "major",
    category: "correctness",
    contextRelaxation: { testFiles: true },
    description: "TypeScript unhandled promise must be MAJOR in production code",
  },
];

/**
 * Convert a user-defined severity floor config entry into a SeverityPattern.
 */
function userFloorToPattern(
  floor: LanguageRulesConfig["severityFloors"][number],
): SeverityPattern {
  return {
    id: `user-${floor.pattern.replace(/\s+/g, "-").toLowerCase()}`,
    language: floor.language ?? "",
    keywords: [[floor.pattern.toLowerCase()]],
    minSeverity: floor.minSeverity,
    contextRelaxation: { testFiles: floor.skipTestFiles },
    description: `User-defined severity floor for "${floor.pattern}"`,
  };
}

type FindingInput = {
  filePath: string;
  title: string;
  severity: FindingSeverity;
  [key: string]: unknown;
};

/**
 * Enforce severity floors on a list of findings.
 *
 * Pure function: no side effects. Operates on findings after LLM extraction
 * but before final filtering/publishing.
 *
 * - Merges built-in patterns with user-defined patterns from config
 * - Detects language per file via classifyFileLanguage
 * - Applies context relaxation for test files
 * - Only elevates severity (never downgrades)
 */
export function enforceSeverityFloors(params: {
  findings: FindingInput[];
  filesByCategory: Record<string, string[]>;
  filesByLanguage: Record<string, string[]>;
  languageRules?: LanguageRulesConfig;
}): (FindingInput & EnforcedFinding)[] {
  const { findings, filesByCategory, languageRules } = params;
  const testFiles = new Set(filesByCategory.test ?? []);

  // Build user patterns from config
  const userPatterns = (languageRules?.severityFloors ?? []).map(userFloorToPattern);

  // Merge patterns: if disableBuiltinFloors, use only user patterns
  const patterns =
    languageRules?.disableBuiltinFloors === true
      ? userPatterns
      : [...BUILTIN_SEVERITY_PATTERNS, ...userPatterns];

  return findings.map((finding) => {
    const isTestFile = testFiles.has(finding.filePath);
    const fileLanguage = classifyFileLanguage(finding.filePath);

    // Find first matching pattern
    const matchedPattern = patterns.find((pattern) => {
      // Language filter: empty string means "any language"
      if (pattern.language && pattern.language !== fileLanguage) return false;
      // Keyword match
      return matchesPattern(finding.title, pattern.keywords);
    });

    if (!matchedPattern) {
      return {
        ...finding,
        originalSeverity: finding.severity,
        severityElevated: false,
        toolingSuppressed: false,
      };
    }

    // Context relaxation: skip enforcement in test files if configured
    if (isTestFile && matchedPattern.contextRelaxation?.testFiles) {
      if (matchedPattern.contextRelaxation.relaxedSeverity) {
        // Use relaxed severity for test files
        const current = severityRank(finding.severity);
        const relaxed = severityRank(matchedPattern.contextRelaxation.relaxedSeverity);
        if (current < relaxed) {
          return {
            ...finding,
            originalSeverity: finding.severity,
            severity: matchedPattern.contextRelaxation.relaxedSeverity,
            severityElevated: true,
            enforcementPatternId: matchedPattern.id,
            toolingSuppressed: false,
          };
        }
      }
      // Skip enforcement entirely for test files
      return {
        ...finding,
        originalSeverity: finding.severity,
        severityElevated: false,
        toolingSuppressed: false,
      };
    }

    // Apply floor: only elevate, never downgrade
    const currentRank = severityRank(finding.severity);
    const floorRank = severityRank(matchedPattern.minSeverity);

    if (currentRank >= floorRank) {
      // Already at or above floor
      return {
        ...finding,
        originalSeverity: finding.severity,
        severityElevated: false,
        toolingSuppressed: false,
      };
    }

    return {
      ...finding,
      originalSeverity: finding.severity,
      severity: matchedPattern.minSeverity,
      severityElevated: true,
      enforcementPatternId: matchedPattern.id,
      toolingSuppressed: false,
    };
  });
}
