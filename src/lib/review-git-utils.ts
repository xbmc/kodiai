/**
 * Normalize a user-authored skip pattern for backward compatibility.
 * - "docs/" -> "docs/**"   (directory shorthand)
 * - "*.md"  -> "**\/*.md"  (extension-only matches nested files)
 */
export function normalizeSkipPattern(pattern: string): string {
  const p = pattern.trim();
  if (p.endsWith("/")) return `${p}**`;
  if (p.startsWith("*.")) return `**/${p}`;
  return p;
}

export function splitGitLines(output: string): string[] {
  return output.trim().split("\n").filter(Boolean);
}

/**
 * Split a full unified diff (multi-file) into per-file segments.
 * Returns an array of `{ filename, patch }` objects for each file in the diff.
 */
export function splitDiffByFile(diffContent: string): Array<{ filename: string; patch: string }> {
  const DIFF_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
  const lines = diffContent.split("\n");
  const files: Array<{ filename: string; patch: string }> = [];
  let currentFilename: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headerMatch = DIFF_HEADER_RE.exec(line);
    if (headerMatch) {
      if (currentFilename !== null && currentLines.length > 0) {
        files.push({ filename: currentFilename, patch: currentLines.join("\n") });
      }
      currentFilename = headerMatch[2]!;
      currentLines = [];
    } else if (currentFilename !== null) {
      currentLines.push(line);
    }
  }
  if (currentFilename !== null && currentLines.length > 0) {
    files.push({ filename: currentFilename, patch: currentLines.join("\n") });
  }

  return files;
}
