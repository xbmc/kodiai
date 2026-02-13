import type { PriorFinding } from "../knowledge/types.ts";

export type PriorFindingContext = {
  unresolvedOnUnchangedCode: PriorFinding[];
  suppressionFingerprints: Set<string>;
};

/**
 * Partition prior findings into unchanged-code context vs suppression
 * fingerprints. Findings on files that have changed since the last review
 * are excluded (the reviewer should re-evaluate them). Findings on unchanged
 * files generate suppression fingerprints to avoid duplicate comments.
 */
export function buildPriorFindingContext(params: {
  priorFindings: PriorFinding[];
  changedFilesSinceLastReview: string[];
}): PriorFindingContext {
  const changedFilesSet = new Set(params.changedFilesSinceLastReview);

  const unresolvedOnUnchangedCode: PriorFinding[] = [];
  const suppressionFingerprints = new Set<string>();

  for (const finding of params.priorFindings) {
    // If the file has changed since the last review, skip -- let the
    // reviewer re-evaluate from scratch
    if (changedFilesSet.has(finding.filePath)) {
      continue;
    }

    // File is unchanged -- this finding is still relevant
    unresolvedOnUnchangedCode.push(finding);
    suppressionFingerprints.add(`${finding.filePath}:${finding.titleFingerprint}`);
  }

  return { unresolvedOnUnchangedCode, suppressionFingerprints };
}

/**
 * Check whether a new finding should be suppressed because an identical
 * finding (same file + title fingerprint) was already reported on unchanged
 * code in a prior review.
 */
export function shouldSuppressFinding(params: {
  filePath: string;
  titleFingerprint: string;
  suppressionFingerprints: Set<string>;
}): boolean {
  return params.suppressionFingerprints.has(
    `${params.filePath}:${params.titleFingerprint}`,
  );
}
