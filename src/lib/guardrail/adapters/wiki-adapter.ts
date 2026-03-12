// ---------------------------------------------------------------------------
// Wiki Surface Adapter
// ---------------------------------------------------------------------------
// Handles wiki update suggestion text with PR citations.
// Grounding context: PR patch diffs (richer than the old checkGrounding()),
// wiki page content, and wiki page title.
// Preserves MediaWiki {{template}} markers and heading structure.
// ---------------------------------------------------------------------------

import { extractClaims } from "../../claim-classifier.ts";
import type { SurfaceAdapter, GroundingContext } from "../types.ts";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export type WikiInput = {
  patchDiffs: Array<{
    prNumber: number;
    prTitle: string;
    patch: string;
  }>;
  wikiPageContent: string;
  wikiPageTitle: string;
};

export type WikiOutput = string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a sentence contains a MediaWiki {{template}} marker. */
function hasTemplateMarker(text: string): boolean {
  return /\{\{[^}]+\}\}/.test(text);
}

/** Check if a line is a MediaWiki heading (== Heading ==). */
function isWikiHeading(line: string): boolean {
  return /^={1,6}\s.*\s={1,6}$/.test(line.trim());
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const wikiAdapter: SurfaceAdapter<WikiInput, WikiOutput> = {
  surface: "wiki",
  minContentThreshold: 10,

  extractClaims(output: WikiOutput): string[] {
    if (!output || output.trim().length === 0) return [];
    return extractClaims(output);
  },

  buildGroundingContext(input: WikiInput): GroundingContext {
    const providedContext: string[] = [];
    const contextSources: string[] = [];

    // Parse patch diffs into context strings with PR numbers for citation grounding
    if (input.patchDiffs.length > 0) {
      for (const diff of input.patchDiffs) {
        providedContext.push(
          `PR #${diff.prNumber} (${diff.prTitle}):\n${diff.patch}`,
        );
      }
      contextSources.push("pr-patches");
    }

    // Wiki page content
    if (input.wikiPageContent) {
      providedContext.push(input.wikiPageContent);
      contextSources.push("wiki-page");
    }

    return { providedContext, contextSources };
  },

  reconstructOutput(output: WikiOutput, keptClaims: string[]): WikiOutput {
    const keptSet = new Set(keptClaims);

    // Extract all sentences to check for template markers
    const allSentences = extractClaims(output);
    const templateSentences = allSentences.filter((s) => hasTemplateMarker(s));

    // If no kept claims and no template sentences, return empty
    if (keptClaims.length === 0 && templateSentences.length === 0) return "";

    const lines = output.split("\n");
    const result: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Wiki headings: keep provisionally (orphan check below)
      if (isWikiHeading(trimmed)) {
        result.push(line);
        continue;
      }

      // Empty lines preserved for structure
      if (trimmed.length === 0) {
        result.push(line);
        continue;
      }

      // Sentence-level filtering
      const sentences = extractClaims(trimmed);
      const keptSentences = sentences.filter(
        (s) => keptSet.has(s) || hasTemplateMarker(s),
      );
      if (keptSentences.length > 0) {
        result.push(keptSentences.join(" "));
      }
    }

    // Remove orphaned wiki headings
    const cleaned: string[] = [];
    for (let i = 0; i < result.length; i++) {
      const trimmed = result[i]!.trim();
      if (isWikiHeading(trimmed)) {
        let hasContent = false;
        for (let j = i + 1; j < result.length; j++) {
          const nextTrimmed = result[j]!.trim();
          if (isWikiHeading(nextTrimmed)) break;
          if (nextTrimmed.length > 0) {
            hasContent = true;
            break;
          }
        }
        if (hasContent) {
          cleaned.push(result[i]!);
        }
      } else {
        cleaned.push(result[i]!);
      }
    }

    return cleaned
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  },
};
