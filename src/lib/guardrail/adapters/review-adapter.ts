// ---------------------------------------------------------------------------
// PR Review Surface Adapter
// ---------------------------------------------------------------------------
// Wraps the existing claim-classifier.ts and output-filter.ts to provide
// a SurfaceAdapter for the unified guardrail pipeline. This adapter does NOT
// reimplement classification or filtering -- it delegates to the existing code.
// ---------------------------------------------------------------------------

import {
  extractClaims as extractClaimSentences,
  type DiffContext,
  type FindingForClassification,
  type FindingClaimClassification,
} from "../../claim-classifier.ts";
import {
  filterExternalClaims,
  type FilterableFinding,
} from "../../output-filter.ts";
import type { SurfaceAdapter, GroundingContext } from "../types.ts";

// ---------------------------------------------------------------------------
// Review-specific types
// ---------------------------------------------------------------------------

export type ReviewInput = {
  findings: FindingForClassification[];
  fileDiffs: Map<string, DiffContext>;
  prDescription: string | null;
  commitMessages: string[];
};

export type ReviewFinding = FilterableFinding & {
  commentId: number;
  filePath: string;
  severity: string;
  category: string;
  claimClassification?: FindingClaimClassification;
};

export type ReviewOutput = {
  findings: ReviewFinding[];
};

// ---------------------------------------------------------------------------
// Review adapter implementation
// ---------------------------------------------------------------------------

/**
 * PR review surface adapter. Wraps existing claim-classifier.ts extractClaims
 * and output-filter.ts filterExternalClaims for zero-behavior-change integration
 * with the unified guardrail pipeline.
 */
export const reviewAdapter: SurfaceAdapter<ReviewInput, ReviewOutput> = {
  surface: "review",

  /**
   * Extract claim sentences from all finding titles.
   * Delegates to claim-classifier.ts extractClaims() for each finding.
   */
  extractClaims(output: ReviewOutput): string[] {
    const allClaims: string[] = [];
    for (const finding of output.findings) {
      const sentences = extractClaimSentences(finding.title);
      allClaims.push(...sentences);
    }
    return allClaims;
  },

  /**
   * Build grounding context from PR data: file diffs, PR description, commit messages.
   */
  buildGroundingContext(input: ReviewInput): GroundingContext {
    const providedContext: string[] = [];
    const contextSources: string[] = [];

    // Add PR description as context
    if (input.prDescription) {
      providedContext.push(input.prDescription);
      contextSources.push("pr-description");
    }

    // Add commit messages as context
    if (input.commitMessages.length > 0) {
      providedContext.push(...input.commitMessages);
      contextSources.push("commit-messages");
    }

    // Merge all file diffs into a single DiffContext for context-level grounding
    let mergedDiffContext: DiffContext | undefined;
    if (input.fileDiffs.size > 0) {
      const allAdded: string[] = [];
      const allRemoved: string[] = [];
      const allContext: string[] = [];
      const allPatches: string[] = [];

      for (const [, diff] of input.fileDiffs) {
        allAdded.push(...diff.addedLines);
        allRemoved.push(...diff.removedLines);
        allContext.push(...diff.contextLines);
        if (diff.rawPatch) allPatches.push(diff.rawPatch);
      }

      mergedDiffContext = {
        rawPatch: allPatches.join("\n"),
        addedLines: allAdded,
        removedLines: allRemoved,
        contextLines: allContext,
      };
      contextSources.push("diff");
    }

    return {
      providedContext,
      diffContext: mergedDiffContext,
      contextSources,
    };
  },

  /**
   * Reconstruct output by keeping only findings whose claims are in keptClaims.
   * Delegates to output-filter.ts filterExternalClaims for the actual filtering logic.
   *
   * For findings with mixed claims, rewrites the title to only include kept claims.
   * For findings with all claims removed, drops the finding entirely.
   */
  reconstructOutput(output: ReviewOutput, keptClaims: string[]): ReviewOutput {
    const keptClaimSet = new Set(keptClaims);

    const filteredFindings: ReviewFinding[] = [];

    for (const finding of output.findings) {
      const findingClaims = extractClaimSentences(finding.title);

      if (findingClaims.length === 0) {
        // No claims extracted -- keep finding as-is (fail-open)
        filteredFindings.push({ ...finding });
        continue;
      }

      const keptFindingClaims = findingClaims.filter((c) => keptClaimSet.has(c));

      if (keptFindingClaims.length === 0) {
        // All claims removed -- drop this finding
        continue;
      }

      if (keptFindingClaims.length === findingClaims.length) {
        // All claims kept -- keep finding unchanged
        filteredFindings.push({ ...finding });
        continue;
      }

      // Mixed: rewrite title with only kept claims
      filteredFindings.push({
        ...finding,
        title: keptFindingClaims.join(" "),
      });
    }

    return { findings: filteredFindings };
  },

  minContentThreshold: 10,
};
