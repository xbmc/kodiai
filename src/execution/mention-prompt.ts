import type { MentionEvent } from "../handlers/mention-types.ts";
import type { UnifiedRetrievalChunk } from "../knowledge/cross-corpus-rrf.ts";
import { sanitizeContent } from "../lib/sanitizer.ts";
import { buildEpistemicBoundarySection, buildSecurityPolicySection, formatUnifiedContext } from "./review-prompt.ts";

/**
 * Build the prompt for a mention-triggered execution.
 *
 * Includes conversation context, the user's question (with @mention stripped),
 * response instructions, and optional custom instructions from .kodiai.yml.
 */
export function buildMentionPrompt(params: {
  mention: MentionEvent;
  mentionContext: string;
  retrievalContext?: {
    findings: Array<{
      findingText: string;
      severity: string;
      category: string;
      path: string;
      line?: number;
      snippet?: string;
      outcome: string;
      distance: number;
      sourceRepo: string;
    }>;
    maxChars?: number;
    maxItems?: number;
  };
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
  /** Unified cross-corpus retrieval results (KI-11/KI-12) */
  unifiedResults?: UnifiedRetrievalChunk[];
  /** Pre-assembled context window from unified pipeline */
  contextWindow?: string;
  /** Triage validation context for issue mentions */
  triageContext?: string;
  /**
   * Pre-fetched PR diff context (stat + truncated full diff) for PR mentions.
   * When present, injected into the prompt so the model does not need tool calls
   * to read the diff — prevents turn exhaustion on large / complex diffs.
   */
  prDiffContext?: {
    stat: string;
    diff: string;
    truncated: boolean;
    fileCount: number;
  };
}): string {
  const {
    mention,
    mentionContext,
    retrievalContext,
    userQuestion,
    findingContext,
    customInstructions,
    outputLanguage,
    unifiedResults,
    contextWindow,
    triageContext,
    prDiffContext,
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

  // Pre-fetched PR diff context — injected to prevent turn exhaustion on review-intent mentions.
  // When present the model has the full diff and does not need to tool-call git to read it.
  if (prDiffContext) {
    lines.push("## PR Diff");
    lines.push(`Files changed: ${prDiffContext.fileCount}`);
    lines.push("");
    lines.push("```diff-stat");
    lines.push(prDiffContext.stat);
    lines.push("```");
    lines.push("");
    lines.push("```diff");
    lines.push(prDiffContext.diff);
    lines.push("```");
    if (prDiffContext.truncated) {
      lines.push("");
      lines.push("*(diff truncated — use file reading tools for sections not shown above)*");
    }
    lines.push("");
  }

  // Unified cross-corpus context takes precedence over legacy retrieval (KI-11/KI-12)
  if (unifiedResults && unifiedResults.length > 0) {
    const unified = formatUnifiedContext({ unifiedResults, contextWindow });
    if (unified.length > 0) {
      lines.push(unified);
      lines.push("");
      lines.push(
        "When referencing information from the knowledge base, cite sources using the labels provided (e.g., [wiki: Page Title], [review: PR #123], [code: file.ts]).",
      );
      lines.push("");
    }
  } else if (retrievalContext && retrievalContext.findings.length > 0) {
    // Legacy retrieval path (backward compat when unified pipeline not active)
    const maxChars = retrievalContext.maxChars ?? 1200;
    const maxItems = retrievalContext.maxItems ?? 3;

    const sorted = [...retrievalContext.findings]
      .sort((a, b) => {
        if (a.distance !== b.distance) {
          return a.distance - b.distance;
        }
        if (a.path !== b.path) {
          return a.path.localeCompare(b.path);
        }
        return (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
      })
      .slice(0, maxItems);

    const rendered = sorted.map((finding) => {
      const snippet = finding.snippet?.replace(/`/g, "'").trim();
      const safeFindingText = finding.findingText.replace(/`/g, "'").trim();
      const evidence = finding.line !== undefined && snippet
        ? `\`${finding.path}:${finding.line}\` -- \`${snippet}\``
        : `\`${finding.path}\` -- ${safeFindingText}`;
      return `- [${finding.severity}/${finding.category}] ${evidence} (source: ${finding.sourceRepo})`;
    });

    const sectionHeader = [
      "## Retrieval",
      "",
      "Use these similar prior findings as supporting context only when they match the current request.",
      "",
    ];

    while (rendered.length > 0) {
      const section = [...sectionHeader, ...rendered].join("\n");
      if (section.length <= maxChars) {
        break;
      }
      rendered.pop();
    }

    if (rendered.length > 0) {
      lines.push(...sectionHeader);
      lines.push(...rendered);
      lines.push("");
    }
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
    "You MUST post a reply when you are mentioned.",
  );
  lines.push("");
  lines.push("## Conversational Response Contract");
  lines.push("");
  lines.push(
    "(1) Direct answer first: open with a direct answer to the user's request before recap or meta commentary.",
  );
  lines.push(
    "(2) Evidence pointers: when claims reference repository code, cite concrete file paths (optionally with :line) tied to each claim; if path context is missing, say so explicitly instead of inventing paths.",
  );
  lines.push(
    "(3) Next-step framing: close with a brief next step or decision prompt that helps the user move forward.",
  );
  lines.push(
    "If context is insufficient, ask exactly one targeted clarifying question that requests the minimum missing detail; do not ask multiple questions and do not use generic wording like 'can you clarify?'.",
  );

  if (mention.surface === "issue_comment") {
    lines.push("");
    lines.push("## Issue Q&A Policy");
    lines.push("");
    lines.push(
      "- Intent-based execution: if the user asks you to implement/fix/change something in the issue, treat it as a write request (no exact `apply:`/`change:` prefix required).",
    );
    lines.push(
      "- Plan requests: if the user asks for a plan, return a concise plan-only response and avoid claiming edits were made.",
    );
    lines.push(
      "- Accuracy wording: never claim files were edited, branches were pushed, or PRs were opened unless those actions actually occurred in this run.",
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

  lines.push("- If (and only if) the user is asking for a PR review / approval decision:");
  lines.push(
    "  - Keep APPROVE responses wrapped in `<details>` so the review stays collapsed in GitHub.",
    "  - Use this exact APPROVE body:",
    "    ```",
    "    <details>",
    '    <summary>kodiai response</summary>',
    "    ",
    "    Decision: APPROVE",
    "    Issues: none",
    "",
    "    Evidence:",
    "    - <factual evidence>",
    "    ",
    "    </details>",
    "    ```",
    "  - Provide 1-3 bullets with short factual evidence derived from already-available counts/confidence summaries.",
    "  - Do NOT add extra headings, paragraphs, HTML comments, or markers; the server adds the review-output marker.",
    "  - If NOT APPROVED, keep using the wrapped decision format below and include only Decision + Issues (no extra explanation paragraphs):",
    "    ```",
    "    <details>",
    '    <summary>kodiai response</summary>',
    "    ",
    "    Decision: NOT APPROVED",
    "    Issues:",
    "    - (1) [critical|major|minor] path/to/file.ts (123, 456): <issue summary>",
    "    ",
    "    </details>",
    "    ```",
  );

  lines.push("- If the user is asking for a plan (e.g. they used `plan:`), respond with:");
  lines.push(
    "  - Prefix first line with: 'Plan only:'",
    "  - One sentence intent",
    "  - Files: <1-6 paths>",
    "  - Steps: 3-7 steps",
    "  - Do NOT claim any edits were made, and do NOT use words like 'Done', 'Implemented', or 'Appended'",
    "  - Do NOT ask the user to re-run with `apply:` / `change:` prefixes",
    "  - End with: 'If you want, I can implement this next.'",
  );

  // Epistemic guardrails (PROMPT-04)
  lines.push("");
  lines.push(buildEpistemicBoundarySection());
  lines.push("", buildSecurityPolicySection());

  // Issue mentions: context-visible tier adaptation
  if (mention.prNumber === undefined) {
    lines.push("");
    lines.push("### Context-Visible Tier (Issue Mentions)");
    lines.push("");
    lines.push(
      "For issue mentions, your \"visible context\" includes: the issue body, comment thread, any linked code snippets, and repository information provided in this prompt. Apply the same epistemic rules — assert what you can see, cite accordingly, silently omit what you cannot verify.",
    );
  }

  // Custom instructions
  if (customInstructions) {
    lines.push("");
    lines.push("## Custom Instructions");
    lines.push("");
    lines.push(customInstructions);
  }

  // Triage context for issue mentions
  if (triageContext && triageContext.trim().length > 0) {
    lines.push("");
    lines.push("## Issue Template Compliance");
    lines.push("");
    lines.push(triageContext);
    lines.push("");
    lines.push(
      "When responding, answer the user's question first (this is your PRIMARY goal). " +
        "Then, if the triage context above indicates missing fields, append a brief one-sentence nudge " +
        "at the end of your response mentioning what's missing. Keep the nudge concise -- one sentence, not a full breakdown.",
    );
    lines.push("");
    lines.push(
      "If a label recommendation is provided above, use the github_issue_label tool to apply it. " +
        "If the label doesn't exist on the repo, skip labeling and mention it briefly.",
    );
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
