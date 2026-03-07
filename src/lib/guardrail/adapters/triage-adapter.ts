// ---------------------------------------------------------------------------
// Triage Surface Adapter
// ---------------------------------------------------------------------------
// Handles triage validation comments on issues.
// Grounding context: issue title, body, label descriptions.
// Filters only prose sections -- table rows and HTML tags are preserved as-is.
// ---------------------------------------------------------------------------

import { extractClaims } from "../../claim-classifier.ts";
import type { SurfaceAdapter, GroundingContext } from "../types.ts";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export type TriageInput = {
  issueTitle: string;
  issueBody: string | null;
  labelDescriptions?: string[];
};

export type TriageOutput = string;

// ---------------------------------------------------------------------------
// Template line detection
// ---------------------------------------------------------------------------

/** Lines that are pure template structure (not prose claims). */
function isTemplateLine(line: string): boolean {
  const trimmed = line.trim();
  // Table rows: | ... |
  if (/^\|.*\|$/.test(trimmed)) return true;
  // Table separator: | --- | --- |
  if (/^\|[\s-:]+\|/.test(trimmed)) return true;
  // HTML tags (self-closing, opening, closing, or wrapping content like <summary>...</summary>)
  if (/^<\/?[a-z][^>]*>/i.test(trimmed)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const triageAdapter: SurfaceAdapter<TriageInput, TriageOutput> = {
  surface: "triage",
  minContentThreshold: 10,

  extractClaims(output: TriageOutput): string[] {
    if (!output || output.trim().length === 0) return [];

    // Split into lines, skip template lines, extract claims from prose only
    const lines = output.split("\n");
    const proseLines: string[] = [];

    for (const line of lines) {
      if (isTemplateLine(line)) continue;
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        proseLines.push(trimmed);
      }
    }

    if (proseLines.length === 0) return [];

    // Join prose and extract sentence-level claims
    return extractClaims(proseLines.join(" "));
  },

  buildGroundingContext(input: TriageInput): GroundingContext {
    const providedContext: string[] = [];
    const contextSources: string[] = [];

    providedContext.push(input.issueTitle);
    if (input.issueBody) providedContext.push(input.issueBody);
    contextSources.push("issue");

    if (input.labelDescriptions?.length) {
      providedContext.push(...input.labelDescriptions);
      contextSources.push("labels");
    }

    return { providedContext, contextSources };
  },

  reconstructOutput(output: TriageOutput, keptClaims: string[]): TriageOutput {
    if (keptClaims.length === 0) {
      // Even with no kept claims, check if there are template lines to preserve
      const lines = output.split("\n");
      const templateLines = lines.filter((l) => isTemplateLine(l));
      if (templateLines.length === 0) return "";
    }

    const keptSet = new Set(keptClaims);
    const lines = output.split("\n");
    const result: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Template lines (tables, HTML) always preserved
      if (isTemplateLine(line)) {
        result.push(line);
        continue;
      }

      // Empty lines preserved for structure
      if (trimmed.length === 0) {
        result.push(line);
        continue;
      }

      // Prose lines: keep only sentences that are in keptClaims
      const sentences = extractClaims(trimmed);
      const keptSentences = sentences.filter((s) => keptSet.has(s));
      if (keptSentences.length > 0) {
        result.push(keptSentences.join(" "));
      }
    }

    return result
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  },
};
