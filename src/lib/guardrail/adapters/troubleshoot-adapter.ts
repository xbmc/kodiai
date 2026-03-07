// ---------------------------------------------------------------------------
// Troubleshoot Surface Adapter
// ---------------------------------------------------------------------------
// Handles troubleshooting agent synthesized guidance.
// Grounding context: resolved issues (body + comments), wiki matches,
// and the current issue title/body.
// ---------------------------------------------------------------------------

import { extractClaims } from "../../claim-classifier.ts";
import type { SurfaceAdapter, GroundingContext } from "../types.ts";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export type TroubleshootInput = {
  resolvedIssues: Array<{
    title: string;
    body: string;
    tailComments: string[];
    semanticComments: string[];
  }>;
  wikiResults: Array<{
    pageTitle: string;
    rawText: string;
  }>;
  issueTitle: string;
  issueBody: string | null;
};

export type TroubleshootOutput = string;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const troubleshootAdapter: SurfaceAdapter<TroubleshootInput, TroubleshootOutput> = {
  surface: "troubleshoot",
  minContentThreshold: 20,

  extractClaims(output: TroubleshootOutput): string[] {
    if (!output || output.trim().length === 0) return [];
    return extractClaims(output);
  },

  buildGroundingContext(input: TroubleshootInput): GroundingContext {
    const providedContext: string[] = [];
    const contextSources: string[] = [];

    // Resolved issues
    if (input.resolvedIssues.length > 0) {
      for (const issue of input.resolvedIssues) {
        providedContext.push(issue.title);
        if (issue.body) providedContext.push(issue.body);
        if (issue.tailComments?.length) providedContext.push(...issue.tailComments);
        if (issue.semanticComments?.length) providedContext.push(...issue.semanticComments);
      }
      contextSources.push("resolved-issues");
    }

    // Wiki results
    if (input.wikiResults.length > 0) {
      for (const wiki of input.wikiResults) {
        providedContext.push(wiki.rawText);
      }
      contextSources.push("wiki");
    }

    // Current issue
    providedContext.push(input.issueTitle);
    if (input.issueBody) providedContext.push(input.issueBody);
    contextSources.push("issue");

    return { providedContext, contextSources };
  },

  reconstructOutput(output: TroubleshootOutput, keptClaims: string[]): TroubleshootOutput {
    if (keptClaims.length === 0) return "";

    const keptSet = new Set(keptClaims);
    const lines = output.split("\n");
    const result: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Empty lines preserved for structure
      if (trimmed.length === 0) {
        result.push(line);
        continue;
      }

      // Bullet points: check content after bullet marker
      const bulletMatch = trimmed.match(/^([*-])\s+(.*)/);
      if (bulletMatch) {
        const bulletContent = bulletMatch[2];
        // Keep if any kept claim matches the bullet content
        const keep = keptClaims.some(
          (claim) => bulletContent.includes(claim) || claim.includes(bulletContent),
        );
        if (keep) {
          result.push(line);
        }
        continue;
      }

      // Regular text: check if any kept claim is in this line
      const keep = keptClaims.some(
        (claim) => trimmed.includes(claim) || claim.includes(trimmed),
      );
      if (keep) {
        result.push(line);
      }
    }

    return result
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  },
};
