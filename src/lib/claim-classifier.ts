// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaimLabel = "diff-grounded" | "external-knowledge" | "inferential";
export type SummaryLabel = "primarily-diff-grounded" | "primarily-external" | "mixed";

export type ClaimClassification = {
  text: string;
  label: ClaimLabel;
  evidence?: string;
  confidence: number;
};

export type FindingClaimClassification = {
  summaryLabel: SummaryLabel;
  claims: ClaimClassification[];
};

/**
 * Minimal input shape the classifier needs — decoupled from review.ts types
 * to avoid circular imports. Any object with at least these fields qualifies.
 */
export type FindingForClassification = {
  commentId: number;
  filePath: string;
  title: string;
  severity: string;
  category: string;
  startLine?: number;
  endLine?: number;
};

/** A finding annotated with claim classification results. */
export type ClaimClassifiedFinding = FindingForClassification & {
  claimClassification: FindingClaimClassification;
};

export type DiffContext = {
  rawPatch: string;
  addedLines: string[];
  removedLines: string[];
  contextLines: string[];
};

export type ClassifierInput = {
  findings: FindingForClassification[];
  fileDiffs: Map<string, DiffContext>;
  prDescription: string | null;
  commitMessages: string[];
};

// ---------------------------------------------------------------------------
// Heuristic patterns
// ---------------------------------------------------------------------------

/** Specific version number pattern: X.Y.Z */
const VERSION_PATTERN = /\b\d+\.\d+\.\d+\b/g;

/** Release date references */
const RELEASE_DATE_PATTERN =
  /(?:introduced|released|added|available|shipped|launched)\s+(?:in|since|from)\s+(?:the\s+)?(?:v?\d|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i;

/** API behavior assertions about external libraries/APIs */
const API_BEHAVIOR_PATTERN =
  /(?:is known to|will always|never returns|always throws|by default .+ returns)/i;

/** Behavioral assertions about libraries */
const LIBRARY_BEHAVIOR_PATTERN =
  /(?:this (?:library|package|module|framework) (?:is|has|does|will|can))/i;

/** CVE references */
const CVE_PATTERN = /CVE-\d{4}-\d+/;

/** Performance/complexity claims */
const PERFORMANCE_PATTERN =
  /(?:is O\([^)]+\)|has .+ complexity|scales (?:linearly|quadratically|exponentially))/i;

/** Compatibility claims */
const COMPATIBILITY_PATTERN =
  /(?:compatible with|requires .+ version|works with .+ \d|only (?:compatible|works) with)/i;

/** Inferential language — deductions from visible code */
const INFERENTIAL_PATTERN =
  /(?:could cause|may lead to|might result in|this means that|could result in|may cause|might cause|will likely|potentially)/i;

/** Diff-grounded signals — references to visible changes */
const DIFF_REFERENCE_PATTERN =
  /(?:removes? the|adds? (?:the|a|an)|changes? the|modifies? the|deletes? the|introduces? (?:a|an|the)|this (?:removes|adds|changes|modifies|deletes|introduces))/i;

// ---------------------------------------------------------------------------
// Claim extraction
// ---------------------------------------------------------------------------

/**
 * Split finding text into individual claim sentences.
 * Uses sentence boundary detection (period followed by space + uppercase or end).
 */
export function extractClaims(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  // Split on sentence boundaries: period/exclamation/question followed by space and uppercase
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return sentences;
}

// ---------------------------------------------------------------------------
// Heuristic classification
// ---------------------------------------------------------------------------

/**
 * Check if a version number appears in the diff content (added, removed, or context lines).
 */
function versionInDiff(version: string, diff: DiffContext | undefined): boolean {
  if (!diff) return false;
  const allDiffText = [...diff.addedLines, ...diff.removedLines, ...diff.contextLines].join("\n");
  return allDiffText.includes(version);
}

/**
 * Check if claim content references something visible in the diff.
 */
function claimReferencesVisibleChange(
  claim: string,
  diff: DiffContext | undefined,
  prDescription: string | null,
  commitMessages: string[],
): boolean {
  if (!diff && !prDescription && commitMessages.length === 0) return false;

  // Check if claim references diff content patterns
  if (DIFF_REFERENCE_PATTERN.test(claim)) {
    // Try to match the subject of the reference against diff lines
    if (diff) {
      const allDiffText = [
        ...diff.addedLines,
        ...diff.removedLines,
        ...diff.contextLines,
      ].join("\n").toLowerCase();

      // Extract key words from claim and check against diff
      const claimWords = claim
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3);

      const matchCount = claimWords.filter((w) => allDiffText.includes(w)).length;
      if (matchCount >= 2) return true;
    }
  }

  // Check if claim substantially matches PR description
  if (prDescription) {
    const descLower = prDescription.toLowerCase();
    const claimLower = claim.toLowerCase();

    // Check for significant word overlap
    const claimWords = claimLower
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const matchCount = claimWords.filter((w) => descLower.includes(w)).length;
    if (claimWords.length > 0 && matchCount / claimWords.length >= 0.5) return true;
  }

  // Check if claim matches commit messages
  for (const msg of commitMessages) {
    const msgLower = msg.toLowerCase();
    const claimLower = claim.toLowerCase();
    const claimWords = claimLower
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const matchCount = claimWords.filter((w) => msgLower.includes(w)).length;
    if (claimWords.length > 0 && matchCount / claimWords.length >= 0.5) return true;
  }

  return false;
}

/**
 * Fast pattern-based claim classification.
 */
export function classifyClaimHeuristic(
  claim: string,
  diffContext: DiffContext | undefined,
  prDescription: string | null,
  commitMessages: string[],
): ClaimClassification {
  // 1. Check for external-knowledge signals first

  // CVE references — always external knowledge
  if (CVE_PATTERN.test(claim)) {
    return {
      text: claim,
      label: "external-knowledge",
      evidence: `CVE reference '${claim.match(CVE_PATTERN)?.[0]}' is external knowledge`,
      confidence: 0.95,
    };
  }

  // Version numbers — external if not in diff
  const versions = claim.match(VERSION_PATTERN);
  if (versions) {
    const allInDiff = versions.every((v) => versionInDiff(v, diffContext));
    if (!allInDiff) {
      const missingVersions = versions.filter((v) => !versionInDiff(v, diffContext));
      return {
        text: claim,
        label: "external-knowledge",
        evidence: `Version number '${missingVersions[0]}' not found in diff content`,
        confidence: 0.9,
      };
    }
    // Version IS in the diff — this is diff-grounded
    return {
      text: claim,
      label: "diff-grounded",
      evidence: `Version numbers ${versions.join(", ")} found in diff content`,
      confidence: 0.9,
    };
  }

  // Release date references
  if (RELEASE_DATE_PATTERN.test(claim)) {
    return {
      text: claim,
      label: "external-knowledge",
      evidence: "Release date reference is external knowledge not visible in diff",
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

  // Performance/complexity claims — external unless code evidence visible
  if (PERFORMANCE_PATTERN.test(claim)) {
    // Check if there's code evidence in the diff (e.g., nested loops)
    if (diffContext) {
      const allDiffText = [...diffContext.addedLines, ...diffContext.removedLines].join("\n");
      const hasNestedLoops =
        /for\s*\(.*\{[\s\S]*for\s*\(/m.test(allDiffText) ||
        /\.forEach\([\s\S]*\.forEach\(/m.test(allDiffText);
      if (hasNestedLoops) {
        return {
          text: claim,
          label: "diff-grounded",
          evidence: "Performance claim supported by visible nested loops in diff",
          confidence: 0.7,
        };
      }
    }
    return {
      text: claim,
      label: "external-knowledge",
      evidence: "Performance/complexity claim not supported by visible code patterns",
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

  // 2. Check for inferential signals — deductions from visible code
  if (INFERENTIAL_PATTERN.test(claim)) {
    // Inferential requires that the PREMISE is visible in diff
    if (diffContext) {
      const allDiffText = [
        ...diffContext.addedLines,
        ...diffContext.removedLines,
        ...diffContext.contextLines,
      ].join("\n").toLowerCase();

      // Extract key content words
      const contentWords = claim
        .toLowerCase()
        .replace(/could cause|may lead to|might result in|this means that|could result in|may cause|might cause|will likely|potentially/gi, "")
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3);

      const matchCount = contentWords.filter((w) => allDiffText.includes(w)).length;
      if (contentWords.length > 0 && matchCount >= 1) {
        return {
          text: claim,
          label: "inferential",
          evidence: "Logical deduction from visible code change",
          confidence: 0.75,
        };
      }
    }
    // Inferential language but no visible premise — could be external reasoning
    return {
      text: claim,
      label: "inferential",
      evidence: "Deductive reasoning pattern detected",
      confidence: 0.55,
    };
  }

  // 3. Check for diff-grounded signals
  if (claimReferencesVisibleChange(claim, diffContext, prDescription, commitMessages)) {
    return {
      text: claim,
      label: "diff-grounded",
      evidence: "Claim references visible code change or PR context",
      confidence: 0.8,
    };
  }

  // 4. Default — if no strong signal, treat as diff-grounded (fail-open)
  return {
    text: claim,
    label: "diff-grounded",
    evidence: "No external-knowledge signals detected, defaulting to diff-grounded",
    confidence: 0.5,
  };
}

// ---------------------------------------------------------------------------
// Summary label
// ---------------------------------------------------------------------------

/**
 * Aggregate per-claim labels into a finding-level summary.
 * - All diff-grounded or inferential → primarily-diff-grounded
 * - All external-knowledge → primarily-external
 * - Mix → mixed
 * - Empty → primarily-diff-grounded (fail-open)
 */
export function computeSummaryLabel(claims: ClaimClassification[]): SummaryLabel {
  if (claims.length === 0) return "primarily-diff-grounded";

  const hasExternal = claims.some((c) => c.label === "external-knowledge");
  const hasGroundedOrInferential = claims.some(
    (c) => c.label === "diff-grounded" || c.label === "inferential",
  );

  if (hasExternal && hasGroundedOrInferential) return "mixed";
  if (hasExternal) return "primarily-external";
  return "primarily-diff-grounded";
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Classify claims in each finding. Fail-open: on any error, returns findings
 * with default classification (primarily-diff-grounded, empty claims).
 */
export function classifyClaims(input: ClassifierInput): ClaimClassifiedFinding[] {
  try {
    const { findings, fileDiffs, prDescription, commitMessages } = input;

    return findings.map((finding) => {
      try {
        const diffContext = fileDiffs?.get(finding.filePath);
        const claimTexts = extractClaims(finding.title);

        const claims = claimTexts.map((text) =>
          classifyClaimHeuristic(text, diffContext, prDescription, commitMessages),
        );

        const summaryLabel = computeSummaryLabel(claims);

        return {
          ...finding,
          claimClassification: {
            summaryLabel,
            claims,
          },
        };
      } catch {
        // Per-finding fail-open
        return {
          ...finding,
          claimClassification: {
            summaryLabel: "primarily-diff-grounded" as SummaryLabel,
            claims: [],
          },
        };
      }
    });
  } catch {
    // Global fail-open: return findings with default classification
    return (input?.findings ?? []).map((finding) => ({
      ...finding,
      claimClassification: {
        summaryLabel: "primarily-diff-grounded" as SummaryLabel,
        claims: [],
      },
    }));
  }
}
