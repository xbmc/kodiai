// ---------------------------------------------------------------------------
// Context-Grounded Claim Classifier
// ---------------------------------------------------------------------------
// Generalizes claim-classifier.ts patterns to work against arbitrary text
// context (issues, wiki pages, conversation) — not just diffs.
// ---------------------------------------------------------------------------

import { classifyClaimHeuristic } from "../claim-classifier.ts";
import { isAllowlistedClaim } from "./allowlist.ts";
import type {
  ClaimClassification,
  GroundingContext,
  StrictnessLevel,
} from "./types.ts";

// ---------------------------------------------------------------------------
// External-knowledge detection patterns (reused from claim-classifier.ts)
// ---------------------------------------------------------------------------

const VERSION_PATTERN = /\b\d+\.\d+\.\d+\b/g;
const CVE_PATTERN = /CVE-\d{4}-\d+/;
const RELEASE_DATE_PATTERN =
  /(?:introduced|released|added|available|shipped|launched)\s+(?:in|since|from)\s+(?:the\s+)?(?:v?\d|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i;
const API_BEHAVIOR_PATTERN =
  /(?:is known to|will always|never returns|always throws|by default .+ returns)/i;
const LIBRARY_BEHAVIOR_PATTERN =
  /(?:this (?:library|package|module|framework) (?:is|has|does|will|can))/i;
const PERFORMANCE_PATTERN =
  /(?:is O\([^)]+\)|has .+ complexity|scales (?:linearly|quadratically|exponentially))/i;
const COMPATIBILITY_PATTERN =
  /(?:compatible with|requires .+ version|works with .+ \d|only (?:compatible|works) with)/i;

// ---------------------------------------------------------------------------
// Strictness thresholds for word overlap
// ---------------------------------------------------------------------------

const OVERLAP_THRESHOLDS: Record<StrictnessLevel, number> = {
  strict: 0.3, // Lower ratio required = easier to ground = stricter filtering of external
  standard: 0.5,
  lenient: 0.7, // Higher ratio required = harder to ground = more claims pass through
};

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * Classify a claim against arbitrary grounding context.
 *
 * Priority order:
 * 1. Allowlist check (general programming knowledge always passes)
 * 2. External-knowledge pattern detection
 * 3. Diff delegation (if diffContext present)
 * 4. Context word overlap grounding
 * 5. Fail-open default (diff-grounded)
 */
export function classifyClaimAgainstContext(
  claim: string,
  context: GroundingContext,
  strictness: StrictnessLevel = "standard",
): ClaimClassification {
  // 1. Allowlist check — general programming knowledge always passes
  if (isAllowlistedClaim(claim)) {
    return {
      text: claim,
      label: "diff-grounded",
      evidence: "Claim matches general programming knowledge allowlist",
      confidence: 0.9,
    };
  }

  // 2. External-knowledge pattern detection

  // CVE references — always external
  if (CVE_PATTERN.test(claim)) {
    return {
      text: claim,
      label: "external-knowledge",
      evidence: `CVE reference '${claim.match(CVE_PATTERN)?.[0]}' is external knowledge`,
      confidence: 0.95,
    };
  }

  // Version numbers — external if not in provided context
  const versions = claim.match(VERSION_PATTERN);
  if (versions) {
    const contextJoined = context.providedContext.join(" ");
    const allInContext = versions.every((v) => contextJoined.includes(v));
    if (!allInContext) {
      return {
        text: claim,
        label: "external-knowledge",
        evidence: `Version number not found in provided context`,
        confidence: 0.9,
      };
    }
  }

  // Release date references
  if (RELEASE_DATE_PATTERN.test(claim)) {
    return {
      text: claim,
      label: "external-knowledge",
      evidence: "Release date reference is external knowledge",
      confidence: 0.9,
    };
  }

  // API behavior assertions
  if (API_BEHAVIOR_PATTERN.test(claim)) {
    return {
      text: claim,
      label: "external-knowledge",
      evidence: "API behavior assertion requires external knowledge",
      confidence: 0.85,
    };
  }

  // Library behavior assertions
  if (LIBRARY_BEHAVIOR_PATTERN.test(claim)) {
    return {
      text: claim,
      label: "external-knowledge",
      evidence: "Library behavior assertion requires external knowledge",
      confidence: 0.85,
    };
  }

  // Performance/complexity claims
  if (PERFORMANCE_PATTERN.test(claim)) {
    return {
      text: claim,
      label: "external-knowledge",
      evidence: "Performance/complexity claim requires external knowledge",
      confidence: 0.8,
    };
  }

  // Compatibility claims
  if (COMPATIBILITY_PATTERN.test(claim)) {
    return {
      text: claim,
      label: "external-knowledge",
      evidence: "Compatibility claim requires external knowledge",
      confidence: 0.85,
    };
  }

  // 3. Delegate to existing heuristic when diffContext is present
  if (context.diffContext) {
    return classifyClaimHeuristic(claim, context.diffContext, null, []);
  }

  // 4. Context word overlap grounding
  if (context.providedContext.length > 0) {
    const contextText = context.providedContext.join(" ").toLowerCase();
    const claimWords = claim
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3);

    if (claimWords.length > 0) {
      const matchCount = claimWords.filter((w) => contextText.includes(w)).length;
      const overlapRatio = matchCount / claimWords.length;
      const threshold = OVERLAP_THRESHOLDS[strictness];

      if (overlapRatio >= threshold) {
        return {
          text: claim,
          label: "diff-grounded",
          evidence: `Claim grounded in context (${Math.round(overlapRatio * 100)}% word overlap)`,
          confidence: 0.7 + overlapRatio * 0.2,
        };
      }
    }
  }

  // 5. Fail-open default
  return {
    text: claim,
    label: "diff-grounded",
    evidence: "No external-knowledge signals detected, defaulting to grounded (fail-open)",
    confidence: 0.5,
  };
}
