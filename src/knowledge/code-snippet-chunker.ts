/**
 * Diff hunk parser, embedding text assembler, and cost-bounding utilities
 * for hunk-level code snippet embedding.
 *
 * Parses unified diff format (git's default), extracts hunks with additions,
 * builds semantic embedding text, and applies per-PR hunk caps.
 */

import picomatch from "picomatch";
import { createHash } from "node:crypto";
import { classifyFileLanguage } from "../execution/diff-analysis.ts";

export type ParsedHunk = {
  filePath: string;
  startLine: number;
  lineCount: number;
  functionContext: string;
  addedLines: string[];
  language: string;
};

const HUNK_HEADER_RE = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@\s*(.*)$/;

/**
 * Parse unified diff text into embeddable hunk chunks.
 *
 * - Extracts hunks at @@ boundaries
 * - Only includes hunks with additions (pure-deletion hunks are excluded)
 * - Applies minChangedLines filter (default: 3)
 * - Classifies language from file path
 */
export function parseDiffHunks(params: {
  diffText: string;
  filePath: string;
  minChangedLines?: number;
}): ParsedHunk[] {
  const { diffText, filePath, minChangedLines = 3 } = params;

  if (!diffText) return [];

  const lines = diffText.split("\n");
  const hunks: ParsedHunk[] = [];
  let currentHunk: ParsedHunk | null = null;
  const language = classifyFileLanguage(filePath);

  for (const line of lines) {
    // Skip file header lines
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }

    // Skip "no newline at end of file" marker
    if (line.startsWith("\\ ")) {
      continue;
    }

    const headerMatch = HUNK_HEADER_RE.exec(line);
    if (headerMatch) {
      // Flush current hunk if it meets the threshold
      if (currentHunk && currentHunk.addedLines.length >= minChangedLines) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        filePath,
        startLine: parseInt(headerMatch[1]!, 10),
        lineCount: parseInt(headerMatch[2] ?? "1", 10),
        functionContext: headerMatch[3]?.trim() ?? "",
        addedLines: [],
        language,
      };
      continue;
    }

    if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.addedLines.push(line.slice(1));
      }
      // Context lines (" ") and deletions ("-") are not added to addedLines
    }
  }

  // Don't forget the last hunk
  if (currentHunk && currentHunk.addedLines.length >= minChangedLines) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Build the text string to be embedded for a hunk.
 *
 * Format: "PR title | file path | function context\nline1\nline2..."
 * Omits function context segment if empty.
 */
export function buildEmbeddingText(params: {
  hunk: ParsedHunk;
  prTitle: string;
}): string {
  const { hunk, prTitle } = params;
  const header = [prTitle, hunk.filePath];
  if (hunk.functionContext) {
    header.push(hunk.functionContext);
  }
  return `${header.join(" | ")}\n${hunk.addedLines.join("\n")}`;
}

/**
 * Check if a file path matches any exclusion glob pattern.
 */
export function isExcludedPath(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const matcher = picomatch(patterns);
  return matcher(filePath);
}

/**
 * Apply per-PR hunk cap, keeping the largest hunks by added line count.
 *
 * If hunks.length <= maxHunks, returns all hunks unchanged.
 * Otherwise sorts by addedLines.length descending (stable) and takes first maxHunks.
 */
export function applyHunkCap(hunks: ParsedHunk[], maxHunks: number): ParsedHunk[] {
  if (maxHunks <= 0) return [];
  if (hunks.length <= maxHunks) return hunks;

  // Stable sort: preserve original order for equal sizes
  const indexed = hunks.map((h, i) => ({ h, i }));
  indexed.sort((a, b) => {
    const diff = b.h.addedLines.length - a.h.addedLines.length;
    if (diff !== 0) return diff;
    return a.i - b.i; // Preserve original order for ties
  });

  return indexed.slice(0, maxHunks).map(({ h }) => h);
}

/**
 * Compute SHA-256 content hash for deduplication.
 */
export function computeContentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
