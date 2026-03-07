// ---------------------------------------------------------------------------
// Mention Surface Adapter
// ---------------------------------------------------------------------------
// Handles @mention responses on issues and PRs.
// Grounding context: issue body, PR description, conversation history,
// retrieval results, and optionally diff patches.
// ---------------------------------------------------------------------------

import { extractClaims } from "../../claim-classifier.ts";
import { parseDiffForClassifier } from "../../claim-classifier.ts";
import type { SurfaceAdapter, GroundingContext } from "../types.ts";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export type MentionInput = {
  issueBody?: string;
  prDescription?: string;
  conversationHistory?: string[];
  retrievalResults?: string[];
  diffPatches?: string[];
};

export type MentionOutput = string;

// ---------------------------------------------------------------------------
// Code block extraction helpers
// ---------------------------------------------------------------------------

type TextSegment = { type: "text" | "code"; content: string };

/**
 * Split text into alternating text/code segments.
 * Code blocks are fenced with ```.
 */
function splitCodeBlocks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const parts = text.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (part.startsWith("```") && part.endsWith("```")) {
      segments.push({ type: "code", content: part });
    } else if (part.length > 0) {
      segments.push({ type: "text", content: part });
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const mentionAdapter: SurfaceAdapter<MentionInput, MentionOutput> = {
  surface: "mention",
  minContentThreshold: 15,

  extractClaims(output: MentionOutput): string[] {
    if (!output || output.trim().length === 0) return [];

    const segments = splitCodeBlocks(output);
    const claims: string[] = [];

    for (const seg of segments) {
      if (seg.type === "code") {
        // Keep code blocks as single claims (never split inside)
        claims.push(seg.content);
      } else {
        claims.push(...extractClaims(seg.content));
      }
    }

    return claims;
  },

  buildGroundingContext(input: MentionInput): GroundingContext {
    const providedContext: string[] = [];
    const contextSources: string[] = [];

    if (input.issueBody) {
      providedContext.push(input.issueBody);
      contextSources.push("issue");
    }

    if (input.prDescription) {
      providedContext.push(input.prDescription);
      contextSources.push("pr-description");
    }

    if (input.conversationHistory?.length) {
      providedContext.push(...input.conversationHistory);
      contextSources.push("conversation");
    }

    if (input.retrievalResults?.length) {
      providedContext.push(...input.retrievalResults);
      contextSources.push("retrieval");
    }

    // Parse first diff patch into diffContext if provided
    let diffContext;
    if (input.diffPatches?.length) {
      providedContext.push(...input.diffPatches);
      contextSources.push("diff");
      diffContext = parseDiffForClassifier(input.diffPatches[0]);
    }

    return { providedContext, diffContext, contextSources };
  },

  reconstructOutput(output: MentionOutput, keptClaims: string[]): MentionOutput {
    if (keptClaims.length === 0) return "";

    const keptSet = new Set(keptClaims);
    const segments = splitCodeBlocks(output);
    const lines: string[] = [];

    for (const seg of segments) {
      if (seg.type === "code") {
        // Code blocks always preserved (never filter inside code blocks)
        lines.push(seg.content);
      } else {
        // Process text line-by-line, filtering at sentence level
        const segLines = seg.content.split("\n");
        for (const line of segLines) {
          const trimmed = line.trim();
          // Headings are handled after assembly
          if (/^#{1,6}\s/.test(trimmed)) {
            lines.push(line);
          } else if (trimmed.length === 0) {
            lines.push("");
          } else {
            // Filter at sentence level within the line
            const sentences = extractClaims(trimmed);
            const keptSentences = sentences.filter((s) => keptSet.has(s));
            if (keptSentences.length > 0) {
              lines.push(keptSentences.join(" "));
            }
          }
        }
      }
    }

    // Remove orphaned headings (headings with no content between them or before end)
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (/^#{1,6}\s/.test(trimmed)) {
        // Look ahead for content (non-empty, non-heading lines)
        let hasContent = false;
        for (let j = i + 1; j < lines.length; j++) {
          const nextTrimmed = lines[j].trim();
          if (/^#{1,6}\s/.test(nextTrimmed)) break; // Next heading found
          if (nextTrimmed.length > 0) {
            hasContent = true;
            break;
          }
        }
        if (hasContent) {
          result.push(lines[i]);
        }
      } else {
        result.push(lines[i]);
      }
    }

    // Clean up excessive blank lines
    return result
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  },
};
