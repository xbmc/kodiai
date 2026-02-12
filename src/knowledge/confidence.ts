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
  if (pattern.startsWith("glob:")) {
    const glob = pattern.slice("glob:".length).toLowerCase();
    const matcher = picomatch(glob, { dot: true });
    return matcher(text.toLowerCase());
  }

  if (pattern.startsWith("regex:")) {
    const source = pattern.slice("regex:".length);
    try {
      return new RegExp(source, "i").test(text);
    } catch {
      return false;
    }
  }

  return text.toLowerCase().includes(pattern.toLowerCase());
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
