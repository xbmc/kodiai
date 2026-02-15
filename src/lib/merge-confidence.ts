/**
 * Merge Confidence Scoring
 *
 * Pure function that maps dependency bump signal combinations (semver classification,
 * advisory status, breaking change detection) to a categorical confidence level
 * (high/medium/low) with rationale strings.
 *
 * @module merge-confidence
 */

import type { DepBumpContext } from "./dep-bump-detector.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MergeConfidenceLevel = "high" | "medium" | "low";

export type MergeConfidence = {
  level: MergeConfidenceLevel;
  rationale: string[];
};

// ─── Severity Ordering ────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

function getMaxAdvisorySeverity(
  advisories: Array<{ severity: string }>,
): string {
  let max = "unknown";
  let maxOrder = 0;
  for (const adv of advisories) {
    const order = SEVERITY_ORDER[adv.severity] ?? 0;
    if (order > maxOrder) {
      maxOrder = order;
      max = adv.severity;
    }
  }
  return max;
}

// ─── Downgrade Helper ─────────────────────────────────────────────────────────

function downgrade(level: MergeConfidenceLevel): MergeConfidenceLevel {
  if (level === "high") return "medium";
  return "low";
}

// ─── Main Function ────────────────────────────────────────────────────────────

/**
 * Computes a merge confidence score from dependency bump signals.
 *
 * Starts at "high" and downgrades based on semver classification,
 * security advisory status, and breaking change detection.
 */
export function computeMergeConfidence(ctx: DepBumpContext): MergeConfidence {
  let level: MergeConfidenceLevel = "high";
  const rationale: string[] = [];

  // ── Semver signal ──────────────────────────────────────────────────────────
  const { bumpType, isBreaking } = ctx.classification;

  if (bumpType === "patch") {
    rationale.push("Patch version bump (bug fix only)");
  } else if (bumpType === "minor") {
    rationale.push("Minor version bump (backward-compatible)");
  } else if (bumpType === "major") {
    level = "medium";
    rationale.push("Major version bump (potential breaking changes)");
  } else {
    level = "medium";
    rationale.push("Version change could not be classified");
  }

  // ── Advisory signal ────────────────────────────────────────────────────────
  const { security } = ctx;

  if (security === undefined) {
    // Enrichment not attempted (e.g. group bump) — no rationale
  } else if (security === null) {
    // Enrichment failed
    rationale.push("Security advisory data unavailable");
  } else if (security.isSecurityBump) {
    rationale.push("Security-motivated bump (patches known vulnerability)");
  } else if (security.advisories.length > 0) {
    const maxSev = getMaxAdvisorySeverity(security.advisories);
    if (maxSev === "critical" || maxSev === "high") {
      level = "low";
      rationale.push(`${maxSev}-severity advisory affects this package`);
    } else {
      level = downgrade(level);
      rationale.push("Security advisories exist for this package");
    }
  } else {
    rationale.push("No known security advisories");
  }

  // ── Breaking change signal ─────────────────────────────────────────────────
  const { changelog } = ctx;

  if (changelog != null) {
    if (changelog.breakingChanges.length > 0) {
      const n = changelog.breakingChanges.length;
      rationale.push(`${n} breaking change(s) detected in changelog`);
      if (isBreaking) {
        // Major + confirmed breaking → low
        level = "low";
      } else {
        level = downgrade(level);
      }
    } else if (changelog.source !== "compare-url-only") {
      rationale.push("No breaking changes detected in changelog");
    }
  }

  return { level, rationale };
}
