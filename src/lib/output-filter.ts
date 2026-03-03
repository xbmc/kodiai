import type { FindingClaimClassification } from "./claim-classifier.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum word count after stripping external sentences. Below this, suppress entirely. */
const MIN_WORDS_AFTER_REWRITE = 10;

/** Footnote appended to rewritten findings */
const REWRITE_FOOTNOTE = "\n\nℹ️ Some claims removed (unverifiable)";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input: a finding with title and optional claim classification */
export type FilterableFinding = {
  title: string;
  commentId: number;
  severity: string;
  category: string;
  filePath: string;
  claimClassification?: FindingClaimClassification;
  [key: string]: unknown;
};

/** Action taken by the filter */
export type FilterAction = "rewritten" | "suppressed";

/** A finding that was suppressed or rewritten, with audit data */
export type FilteredFindingRecord = {
  commentId: number;
  originalTitle: string;
  action: FilterAction;
  rewrittenTitle?: string;
  reason: string;
  classificationEvidence: string[];
};

/** Result of filtering a batch of findings */
export type FilterResult<T extends FilterableFinding> = {
  /** Findings that survived (may have rewritten titles) */
  findings: T[];
  /** Records of all suppressed/rewritten findings for logging */
  filtered: FilteredFindingRecord[];
  /** Count of rewritten findings */
  rewriteCount: number;
  /** Count of suppressed findings */
  suppressionCount: number;
};

type FilterLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count words in a string (split on whitespace). */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Collect evidence strings from external-knowledge claims. */
function collectExternalEvidence(
  classification: FindingClaimClassification,
): string[] {
  return (classification.claims ?? [])
    .filter((c) => c.label === "external-knowledge")
    .map((c) => c.evidence)
    .filter((e): e is string => Boolean(e));
}

/** Build a human-readable reason from evidence strings. */
function buildReason(evidence: string[]): string {
  if (evidence.length > 0) {
    return `External knowledge claims: ${evidence.join("; ")}`;
  }
  return "Finding primarily depends on unverified external knowledge";
}

// ---------------------------------------------------------------------------
// Core filter
// ---------------------------------------------------------------------------

/**
 * Filter findings with external knowledge claims.
 *
 * - `primarily-external` findings are suppressed entirely.
 * - `mixed` findings are rewritten: external-knowledge sentences removed,
 *   diff-grounded and inferential sentences kept verbatim.
 * - `primarily-diff-grounded` and unclassified findings pass through unchanged.
 *
 * Fail-open: missing or errored classification data never suppresses a finding.
 * Returns new objects — inputs are never mutated.
 */
export function filterExternalClaims<T extends FilterableFinding>(
  findings: T[],
  logger?: FilterLogger,
): FilterResult<T> {
  const outputFindings: T[] = [];
  const filtered: FilteredFindingRecord[] = [];
  let rewriteCount = 0;
  let suppressionCount = 0;

  for (const finding of findings) {
    const classification = finding.claimClassification;

    // Fail-open: no classification → pass through
    if (!classification) {
      outputFindings.push({ ...finding });
      continue;
    }

    const { summaryLabel } = classification;

    // Primarily diff-grounded → pass through unchanged
    if (summaryLabel === "primarily-diff-grounded") {
      outputFindings.push({ ...finding });
      continue;
    }

    // Primarily external → suppress entirely
    if (summaryLabel === "primarily-external") {
      const evidence = collectExternalEvidence(classification);
      const reason = buildReason(evidence);

      const record: FilteredFindingRecord = {
        commentId: finding.commentId,
        originalTitle: finding.title,
        action: "suppressed",
        reason,
        classificationEvidence: evidence,
      };
      filtered.push(record);
      suppressionCount++;

      if (logger) {
        logger.info(
          {
            commentId: finding.commentId,
            originalTitle: finding.title,
            action: "suppressed" as const,
            reason,
            summaryLabel,
          },
          "Output filter: finding suppressed (primarily external knowledge)",
        );
      }

      continue;
    }

    // Mixed → attempt rewrite
    if (summaryLabel === "mixed") {
      const claims = classification.claims ?? [];
      const keptSentences = claims
        .filter((c) => c.label !== "external-knowledge")
        .map((c) => c.text);

      const joinedText = keptSentences.join(" ");
      const evidence = collectExternalEvidence(classification);
      const reason = buildReason(evidence);

      // Stub detection: if remaining text is too short, suppress instead
      if (countWords(joinedText) < MIN_WORDS_AFTER_REWRITE) {
        const record: FilteredFindingRecord = {
          commentId: finding.commentId,
          originalTitle: finding.title,
          action: "suppressed",
          reason: `${reason}; remaining text too short after rewrite (${countWords(joinedText)} words < ${MIN_WORDS_AFTER_REWRITE} minimum)`,
          classificationEvidence: evidence,
        };
        filtered.push(record);
        suppressionCount++;

        if (logger) {
          logger.info(
            {
              commentId: finding.commentId,
              originalTitle: finding.title,
              action: "suppressed" as const,
              reason: record.reason,
              summaryLabel,
              remainingWords: countWords(joinedText),
            },
            "Output filter: mixed finding suppressed (too short after rewrite)",
          );
        }

        continue;
      }

      // Rewrite: keep diff-grounded + inferential sentences, add footnote
      const rewrittenTitle = joinedText + REWRITE_FOOTNOTE;

      const record: FilteredFindingRecord = {
        commentId: finding.commentId,
        originalTitle: finding.title,
        action: "rewritten",
        rewrittenTitle,
        reason,
        classificationEvidence: evidence,
      };
      filtered.push(record);
      rewriteCount++;

      outputFindings.push({ ...finding, title: rewrittenTitle });

      if (logger) {
        logger.info(
          {
            commentId: finding.commentId,
            originalTitle: finding.title,
            action: "rewritten" as const,
            rewrittenTitle,
            reason,
            summaryLabel,
          },
          "Output filter: finding rewritten (external claims removed)",
        );
      }

      continue;
    }

    // Unknown summaryLabel → fail-open, pass through
    outputFindings.push({ ...finding });
  }

  return {
    findings: outputFindings,
    filtered,
    rewriteCount,
    suppressionCount,
  };
}

// ---------------------------------------------------------------------------
// Suppressed findings section for review summary
// ---------------------------------------------------------------------------

/**
 * Format a collapsed `<details>` section listing suppressed findings.
 *
 * Returns empty string if no findings were suppressed (only rewritten
 * findings exist, or the filtered list is empty). The section is only
 * rendered when there are actual suppressions to report.
 */
export function formatSuppressedFindingsSection(
  filtered: FilteredFindingRecord[],
): string {
  const suppressed = filtered.filter((r) => r.action === "suppressed");

  if (suppressed.length === 0) {
    return "";
  }

  const MAX_TITLE_LENGTH = 80;

  const entries = suppressed.map((r) => {
    const truncatedTitle =
      r.originalTitle.length > MAX_TITLE_LENGTH
        ? r.originalTitle.slice(0, MAX_TITLE_LENGTH) + "..."
        : r.originalTitle;
    return `- **${truncatedTitle}** — ${r.reason}`;
  });

  return [
    "<details>",
    `<summary>Filtered findings (${suppressed.length} finding${suppressed.length === 1 ? "" : "s"} removed — unverifiable claims)</summary>`,
    "",
    ...entries,
    "",
    "</details>",
  ].join("\n");
}
