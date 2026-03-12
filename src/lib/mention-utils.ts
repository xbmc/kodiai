/**
 * Pure utility functions extracted from src/handlers/mention.ts.
 *
 * All functions here take explicit parameters and have no closure over
 * handler state. This is a light extraction per DECISIONS.md
 * ("M026: Light extraction only for review.ts/mention.ts").
 */

import type { WritePolicyError } from "../jobs/workspace.ts";

/**
 * Build a human-readable refusal message for write-policy violations.
 * Includes context-specific remediation hints based on the error code.
 */
export function buildWritePolicyRefusalMessage(
  err: WritePolicyError,
  allowPaths: string[],
): string {
  const yamlSingleQuote = (s: string): string => s.replaceAll("'", "''");

  const lines: string[] = [];
  lines.push("Write request refused.");
  lines.push("");
  lines.push(`Reason: ${err.code}`);
  if (err.rule) lines.push(`Rule: ${err.rule}`);
  if (err.path) lines.push(`File: ${err.path}`);
  if (err.pattern) lines.push(`Matched pattern: ${err.pattern}`);
  if (err.detector) lines.push(`Detector: ${err.detector}`);
  lines.push("");
  lines.push(err.message);

  if (err.code === "write-policy-not-allowed" && err.path) {
    const escapedPath = yamlSingleQuote(err.path);
    lines.push("");
    lines.push("Smallest config change (if intended):");
    lines.push("Update `.kodiai.yml`:");
    lines.push("```yml");
    lines.push("write:");
    lines.push("  allowPaths:");
    lines.push(`    - '${escapedPath}'`);
    lines.push("```");

    if (allowPaths.length > 0) {
      lines.push("");
      lines.push(
        `Current allowPaths: ${allowPaths
          .map((p) => `'${yamlSingleQuote(p)}'`)
          .join(", ")}`,
      );
    }
  } else if (err.code === "write-policy-denied-path") {
    lines.push("");
    lines.push("Config change required to allow this path is potentially risky.");
    lines.push("If you explicitly want to allow it, narrow or remove the matching denyPaths entry.");
  } else if (err.code === "write-policy-secret-detected") {
    lines.push("");
    lines.push("No safe config bypass suggested.");
    lines.push("Remove/redact the secret-like content and retry.");
    lines.push("(If this is a false positive, you can disable secretScan, but that reduces safety.)");
  } else if (err.code === "write-policy-no-changes") {
    lines.push("");
    lines.push("No file changes were produced.");
    lines.push("Restate the change request with a concrete file + edit.");
  }

  return lines.join("\n");
}

/**
 * Pure function that scans added diff lines for fabricated content patterns.
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
      // Check for all-same-character hex strings (e.g. "aaaaaa...") first
      // since these are a subset of repeating patterns
      if (hex.length >= 32 && new Set(hex.toLowerCase()).size <= 2) {
        warnings.push(
          `Suspicious low-entropy hex pattern in added line: \`${hex.substring(0, 40)}...\``,
        );
        break;
      }
      // Check for 16-char substring repetition
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
    // Reset lastIndex for next line
    hexPattern.lastIndex = 0;
  }

  return warnings;
}
