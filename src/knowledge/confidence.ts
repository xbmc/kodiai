import picomatch from "picomatch";
import type { FindingCategory, FindingSeverity } from "./types.ts";

export type ConfidenceInput = {
  severity: FindingSeverity;
  category: FindingCategory;
  matchesKnownPattern: boolean;
};

export type SuppressionPattern = {
  pattern: string;
  severity?: FindingSeverity[];
  category?: FindingCategory[];
  paths?: string[];
};

type SuppressionFinding = {
  title: string;
  severity: FindingSeverity;
  category: FindingCategory;
  filePath: string;
};

const SEVERITY_BOOST: Record<FindingSeverity, number> = {
  critical: 30,
  major: 20,
  medium: 10,
  minor: 0,
};

const CATEGORY_BOOST: Record<FindingCategory, number> = {
  security: 15,
  correctness: 10,
  performance: 5,
  style: -5,
  documentation: -10,
};

const MAX_REGEX_PATTERN_LENGTH = 512;
const NESTED_QUANTIFIER_PATTERN = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*?]|\{\d+(?:,\d*)?\})/;
const QUANTIFIED_SIMPLE_ALTERNATION_PATTERN = /\(([^()\\]+(?:\|[^()\\]+)+)\)\s*(?:[+*?]|\{\d+(?:,\d*)?\})/g;

export function computeConfidence(input: ConfidenceInput): number {
  let score = 50;
  score += SEVERITY_BOOST[input.severity];
  score += CATEGORY_BOOST[input.category];
  if (input.matchesKnownPattern) {
    score += 10;
  }
  return Math.min(100, Math.max(0, score));
}

export function matchPattern(pattern: string, text: string): boolean {
  return createPatternMatcher(pattern)(text);
}

export function matchesSuppression(
  finding: SuppressionFinding,
  suppression: string | SuppressionPattern,
): boolean {
  const config: SuppressionPattern =
    typeof suppression === "string" ? { pattern: suppression } : suppression;

  if (!matchPattern(config.pattern, finding.title)) {
    return false;
  }

  if (config.severity && !config.severity.includes(finding.severity)) {
    return false;
  }

  if (config.category && !config.category.includes(finding.category)) {
    return false;
  }

  if (config.paths && config.paths.length > 0) {
    const matchesPath = config.paths.some((pattern) =>
      picomatch(pattern, { dot: true })(finding.filePath)
    );
    if (!matchesPath) {
      return false;
    }
  }

  return true;
}

export function createSuppressionMatcher(
  suppression: string | SuppressionPattern,
): (finding: SuppressionFinding) => boolean {
  const config: SuppressionPattern =
    typeof suppression === "string" ? { pattern: suppression } : suppression;
  const titleMatcher = createPatternMatcher(config.pattern);
  const pathMatchers = config.paths?.map((pattern) => picomatch(pattern, { dot: true })) ?? [];

  return (finding) => {
    if (!titleMatcher(finding.title)) {
      return false;
    }

    if (config.severity && !config.severity.includes(finding.severity)) {
      return false;
    }

    if (config.category && !config.category.includes(finding.category)) {
      return false;
    }

    if (pathMatchers.length > 0 && !pathMatchers.some((matcher) => matcher(finding.filePath))) {
      return false;
    }

    return true;
  };
}

function hasQuantifiedOverlappingAlternation(source: string): boolean {
  QUANTIFIED_SIMPLE_ALTERNATION_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(QUANTIFIED_SIMPLE_ALTERNATION_PATTERN)) {
    const alternatives = match[1]!.split("|");
    for (let i = 0; i < alternatives.length; i++) {
      for (let j = 0; j < alternatives.length; j++) {
        if (i !== j && alternatives[j]!.startsWith(alternatives[i]!)) {
          return true;
        }
      }
    }
  }
  return false;
}

function createPatternMatcher(pattern: string): (text: string) => boolean {
  if (pattern.startsWith("glob:")) {
    const glob = pattern.slice("glob:".length).toLowerCase();
    const matcher = picomatch(glob, { dot: true });
    return (text) => matcher(text.toLowerCase());
  }

  if (pattern.startsWith("regex:")) {
    const source = pattern.slice("regex:".length);
    if (
      source.length > MAX_REGEX_PATTERN_LENGTH ||
      NESTED_QUANTIFIER_PATTERN.test(source) ||
      hasQuantifiedOverlappingAlternation(source)
    ) {
      return () => false;
    }
    try {
      const matcher = new RegExp(source, "i");
      return (text) => matcher.test(text);
    } catch {
      return () => false;
    }
  }

  const needle = pattern.toLowerCase();
  return (text) => text.toLowerCase().includes(needle);
}
