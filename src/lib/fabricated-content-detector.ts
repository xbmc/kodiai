/**
 * Scans added diff lines for fabricated content patterns.
 * Detects repeating hex patterns and low-entropy hex strings that are
 * classic hallucination signatures from LLMs.
 */
export function scanLinesForFabricatedContent(addedLines: string[]): string[] {
  const warnings: string[] = [];
  const hexPattern = /[0-9a-fA-F]{32,}/g;

  for (const line of addedLines) {
    let match: RegExpExecArray | null;
    while ((match = hexPattern.exec(line)) !== null) {
      const hex = match[0];
      if (hex.length >= 32 && new Set(hex.toLowerCase()).size <= 2) {
        warnings.push(
          `Suspicious low-entropy hex pattern in added line: \`${hex.substring(0, 40)}...\``,
        );
        break;
      }
      if (hex.length >= 32) {
        const half = hex.substring(0, 16);
        if (hex.includes(half, 16)) {
          warnings.push(
            `Suspicious repeating hex pattern in added line: \`${hex.substring(0, 40)}...\``,
          );
          break;
        }
      }
    }
    hexPattern.lastIndex = 0;
  }

  return warnings;
}
