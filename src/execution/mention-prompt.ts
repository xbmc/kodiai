import type { MentionEvent } from "../handlers/mention-types.ts";
import { sanitizeContent } from "../lib/sanitizer.ts";

/**
 * Build the prompt for a mention-triggered execution.
 *
 * Includes conversation context, the user's question (with @mention stripped),
 * response instructions, and optional custom instructions from .kodiai.yml.
 */
export function buildMentionPrompt(params: {
  mention: MentionEvent;
  mentionContext: string;
  userQuestion: string;
  findingContext?: {
    severity: string;
    category: string;
    filePath: string;
    startLine: number | null;
    title: string;
  };
  customInstructions?: string;
  outputLanguage?: string;
}): string {
  const {
    mention,
    mentionContext,
    userQuestion,
    findingContext,
    customInstructions,
    outputLanguage,
  } = params;
  const lines: string[] = [];

  // Context header
  lines.push(`You are assisting with a question in ${mention.owner}/${mention.repo}.`);
  if (mention.prNumber !== undefined) {
    lines.push(`This is about Pull Request #${mention.prNumber}.`);
  } else {
    lines.push(`This is about Issue #${mention.issueNumber}.`);
  }

  if (mention.surface === "pr_review_comment") {
    lines.push(
      `This mention was triggered by an inline PR review comment (review comment id: ${mention.commentId}).`,
    );
  }
  lines.push("");

  if (findingContext) {
    lines.push("This is a follow-up to a review finding:");
    lines.push(
      `- Finding: [${findingContext.severity.toUpperCase()}] ${findingContext.category}`,
    );
    if (findingContext.startLine !== null) {
      lines.push(`- File: ${findingContext.filePath} (line ${findingContext.startLine})`);
    } else {
      lines.push(`- File: ${findingContext.filePath}`);
    }
    lines.push(`- Title: ${findingContext.title}`);
    lines.push(
      "Provide a focused response that addresses the user's question about this specific finding. Reference the finding's reasoning and suggest concrete code changes if applicable.",
    );
    lines.push("");
  }

  // Context (optional)
  if (mentionContext.trim().length > 0) {
    lines.push(mentionContext);
    lines.push("");
  }

  // User's question
  lines.push("## User's Question");
  lines.push("");
  lines.push(`@${mention.commentAuthor} asked:`);
  lines.push(sanitizeContent(userQuestion));
  lines.push("");

  // Response instructions
  lines.push("## How to respond");
  lines.push("");
  lines.push(
    "Important: The handler already added an eyes reaction for tracking. Do not post a separate tracking/ack comment.",
  );
  lines.push(
    "Do NOT create a 'thinking'/'working on it' comment. Create at most ONE comment total, and only when you are ready to provide the final response.",
  );
  lines.push(
    "Do NOT update comments (avoid using update_comment); post a single final response instead.",
  );
  lines.push(
    "You MUST post a reply when you are mentioned. If you do not have enough information to fully answer, ask 1-3 targeted clarifying questions instead of staying silent.",
  );

  if (mention.surface === "issue_comment") {
    lines.push("");
    lines.push("## Issue Q&A Requirements");
    lines.push("");
    lines.push(
      "- Direct answer first: the first sentence must directly answer the user's question; do not start with a recap.",
    );
    lines.push(
      "- File-path evidence: when making claims about repository code, include 1-5 concrete paths (optionally with :line like src/file.ts:42) and tie each path to the specific claim it supports.",
    );
    lines.push(
      "- No fabricated pointers: if reliable path evidence is missing, explicitly say path context is missing and ask targeted follow-up questions instead of inventing file names.",
    );
    lines.push(
      "- Clarification quality: when the request is underspecified, ask 1-3 targeted questions that unblock implementation-level guidance; do not ask generic questions like 'can you clarify?'.",
    );
    lines.push(
      "- Read-only by default: unless the user message starts with `apply:` or `change:`, keep the reply guidance-only and do not imply files were edited, a branch was pushed, or a PR was opened.",
    );
    lines.push(
      "- Anti-completion wording: for non-prefixed issue comments, never claim work is already done (forbidden phrasing includes 'updated', 'implemented', 'fixed', 'completed', or statements that imply repository edits already happened).",
    );
    lines.push(
      "- Write-mode opt-in wording: if the user asks for implementation without an `apply:`/`change:` prefix, include both exact commands: `@kodiai apply: <same request>` and `@kodiai change: <same request>`.",
    );
    lines.push(
      "- Single-response rule: post one final in-thread response only; do not add extra acknowledgement comments.",
    );
  }
  lines.push("");

  if (mention.surface === "pr_review_comment") {
    lines.push(
      "Write your response by replying in the same inline thread using the `mcp__reviewCommentThread__reply_to_pr_review_comment` tool.",
    );
    lines.push(
      `Use: pullRequestNumber=${mention.prNumber} and commentId=${mention.commentId}.`,
    );
    lines.push(
      "If the thread reply tool fails for any reason, fall back to posting a single top-level reply using `mcp__github_comment__create_comment` on the PR.",
    );
  } else {
    lines.push(
      `Write your response by creating a new top-level comment using the \`mcp__github_comment__create_comment\` tool on issue/PR #${mention.issueNumber}.`,
    );
  }
  lines.push("");
  lines.push("Your response should be:");
  lines.push(
    "- Concise by default -- provide only what was asked; avoid long recaps",
  );
  lines.push(
    '- Do NOT include sections like "What Changed", "Key Strengths", or "Minor Observations" unless explicitly requested',
  );
  lines.push("- Direct and helpful -- answer the question with specific code references where possible");
  lines.push("- Aware of the conversation context above -- don't repeat what's already been discussed");
  lines.push("- Formatted in GitHub-flavored markdown");
  lines.push(
    "- When listing items, use (1), (2), (3) format -- NEVER #1, #2, #3 (GitHub treats those as issue links)",
  );
  lines.push(
    "- ALWAYS wrap your ENTIRE response body in `<details>` tags to reduce noise in the thread:",
    "  ```",
    "  <details>",
    '  <summary>kodiai response</summary>',
    "  ",
    "  Your response content here...",
    "  ",
    "  </details>",
    "  ```",
    "- Important: include a blank line after `<summary>` and before `</details>` for proper markdown rendering",
  );

  lines.push("- If (and only if) the user is asking for a PR review / approval decision, use this exact structure:");
  lines.push(
    "  ```",
    "  <details>",
    '  <summary>kodiai response</summary>',
    "  ",
    "  Decision: APPROVE | NOT APPROVED",
    "  Issues:",
    "  - (1) [critical|major|minor] path/to/file.ts (123, 456): <issue summary>",
    "  ",
    "  </details>",
    "  ```",
  );
  lines.push(
    "  Notes:",
    "  - If APPROVE: keep it to 1-2 lines and set `Issues: none`.",
    "  - If NOT APPROVED: include only Decision + Issues (no extra explanation paragraphs).",
  );

  lines.push("- If the user is asking for a plan (e.g. they used `plan:`), respond with:");
  lines.push(
    "  - Prefix first line with: 'Plan only:'",
    "  - One sentence intent",
    "  - Files: <1-6 paths>",
    "  - Steps: 3-7 steps",
    "  - Do NOT claim any edits were made, and do NOT use words like 'Done', 'Implemented', or 'Appended'",
    "  - End with: 'Reply with apply: <same request> to implement.'",
  );

  // Factual accuracy guardrail
  lines.push("");
  lines.push("## Factual Accuracy — CRITICAL");
  lines.push("");
  lines.push(
    "NEVER generate changelogs, CVE details, release notes, version histories, security advisories, or any other factual claims about external projects from memory.",
    "This information changes constantly and your training data WILL be wrong or outdated.",
    "",
    "When a user asks about external information (changelogs, CVEs, release notes, API docs, etc.):",
    "- You MUST use WebSearch and/or WebFetch to look up the actual source of truth",
    "- If WebSearch/WebFetch are unavailable or fail, say so explicitly — do NOT fall back to generating from memory",
    "- NEVER present unverified information as fact",
    "- NEVER invent CVE numbers, version numbers, or changelog entries",
    "",
    "This applies to ALL external factual claims, not just security-related ones.",
    "If you cannot verify something, say: \"I wasn't able to look this up — here's what I'd suggest checking: [links/sources]\"",
  );

  // Custom instructions
  if (customInstructions) {
    lines.push("");
    lines.push("## Custom Instructions");
    lines.push("");
    lines.push(customInstructions);
  }

  // Output language localization
  if (outputLanguage && outputLanguage.toLowerCase() !== "en") {
    lines.push(
      "",
      `Write your response in ${outputLanguage}. Keep code identifiers, snippets, file paths, and technical terms in their original form.`,
    );
  }

  return lines.join("\n");
}
