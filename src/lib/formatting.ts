/**
 * Formatting utilities for GitHub comment bodies.
 *
 * Provides collapsible <details> wrapping for ALL bot responses to reduce
 * visual noise in issue/PR threads (UX-03).
 */

/**
 * Wrap a body in collapsible <details> tags.
 *
 * ALL bot comments are wrapped unconditionally to reduce noise.
 *
 * Rules:
 * - Bodies already starting with <details> are not double-wrapped
 * - Blank lines are added after <summary> and before </details> for
 *   correct GitHub markdown rendering
 *
 * @param body - The comment body to wrap
 * @param summaryText - Optional custom summary line (defaults to char count)
 * @returns The wrapped body
 */
export function wrapInDetails(body: string, summaryText?: string): string {
  if (body.trimStart().startsWith("<details>")) return body; // Already wrapped

  const summary = summaryText ?? `Kodiai response (${body.length} characters)`;
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}
