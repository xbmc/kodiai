import type { ExecutionContext } from "./types.ts";
import { sanitizeContent } from "../lib/sanitizer.ts";

/**
 * Build the prompt string passed to query().
 *
 * This is a simple scaffold for Phase 3. Phase 4 (PR review) and Phase 5
 * (mention handling) will extend it with richer context (diff, conversation
 * history, etc.).
 */
export function buildPrompt(context: ExecutionContext): string {
  const lines = [
    `You are reviewing a GitHub repository. Event: ${context.eventType}`,
    `Repository: ${context.owner}/${context.repo}`,
  ];

  if (context.prNumber !== undefined) {
    lines.push(`Pull Request: #${context.prNumber}`);
  }

  lines.push("", `User message:\n\n${sanitizeContent(context.triggerBody)}`);
  lines.push(
    "",
    "Analyze the code and provide feedback. Use the available MCP tools to post your findings as GitHub comments.",
  );

  return lines.join("\n");
}
