/**
 * Formatting utilities for GitHub comment bodies.
 *
 * Provides collapsible <details> wrapping for long responses to reduce
 * visual noise in issue/PR threads (UX-03).
 */

const COLLAPSE_THRESHOLD = 500;

/**
 * Wrap a body in collapsible <details> tags if it exceeds the threshold.
 *
 * Rules:
 * - Bodies of 500 characters or fewer are returned unchanged
 * - Bodies already starting with <details> are not double-wrapped
 * - Blank lines are added after <summary> and before </details> for
 *   correct GitHub markdown rendering
 *
 * @param body - The comment body to potentially wrap
 * @param summaryText - Optional custom summary line (defaults to char count)
 * @returns The original or wrapped body
 */
export function wrapInDetails(body: string, summaryText?: string): string {
  if (body.length <= COLLAPSE_THRESHOLD) return body;
  if (body.trimStart().startsWith("<details>")) return body; // Already wrapped

  const summary = summaryText ?? `Kodiai response (${body.length} characters)`;
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}
