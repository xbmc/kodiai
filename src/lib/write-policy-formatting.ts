import type { WritePolicyError } from "./write-policy-error.ts";

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
