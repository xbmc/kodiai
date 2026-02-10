# Phase 9: Review UX Improvements - Research

**Researched:** 2026-02-08
**Domain:** GitHub API (Reactions, Comments, Markdown formatting)
**Confidence:** HIGH

## Summary

Phase 9 adds three UX improvements to Kodiai's existing review and mention handlers: (1) eyes emoji reactions on trigger comments/events for instant visual acknowledgment, (2) automatic `<details>` wrapping for long responses to reduce noise, and (3) structured PR summary comments showing what changed, why, and which files were modified.

All three requirements are achievable using APIs and patterns already present in the codebase. The GitHub Reactions API (`octokit.rest.reactions.*`) is available in `@octokit/rest@22.0.1` (already installed). The `<details>`/`<summary>` HTML tags are natively supported in GitHub-flavored Markdown. The structured PR summary is a prompt engineering task that instructs Claude to post a summary comment via the existing `create_comment` MCP tool.

**Primary recommendation:** Implement all three requirements as handler-level changes (reactions in handlers, `<details>` wrapping as a shared utility, summary as a review prompt extension) -- no new dependencies needed.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@octokit/rest` | ^22.0.1 | GitHub Reactions API calls | Already installed; `reactions.createForIssueComment`, `createForPullRequestReviewComment`, `createForIssue` confirmed available |
| GitHub Markdown | N/A | `<details>`/`<summary>` tags | Native GitHub-flavored Markdown -- no library needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | - | All requirements use existing dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Handler-level reactions | MCP tool for reactions | Adds complexity; reactions need to fire BEFORE job enqueue (immediate feedback), so handler-level is correct |
| `<details>` wrapping in handler | MCP tool wrapping | MCP tool can't know the full response length; wrapping must happen at the point the comment body is known. For mention responses, Claude writes via MCP tool, so wrapping should be in the prompt instructions. For the summary comment, it can be done in the prompt or as a post-processing step |
| Structured summary via separate API call | Summary in Claude's prompt | Letting Claude generate the summary via prompt is simpler and produces higher-quality natural language summaries |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── handlers/
│   ├── review.ts            # Add eyes reaction + summary prompt changes
│   └── mention.ts           # Add eyes reaction on trigger comment
├── execution/
│   ├── review-prompt.ts     # Add structured summary instructions
│   └── mention-prompt.ts    # Add <details> wrapping instructions
├── lib/
│   └── formatting.ts        # NEW: wrapInDetails() utility
└── (existing files unchanged)
```

### Pattern 1: Eyes Reaction on Trigger (UX-02)

**What:** Add an eyes emoji reaction to the trigger comment/PR immediately when processing begins, before job enqueue.

**When to use:** Both mention handler and review handler entry points.

**Approach:**

For mentions, the trigger is always a comment. Use `octokit.rest.reactions.createForIssueComment()` for issue/PR comments, and `octokit.rest.reactions.createForPullRequestReviewComment()` for PR review comments.

For PR auto-review, the trigger is the PR itself (not a comment). Use `octokit.rest.reactions.createForIssue()` -- GitHub's Issues API treats PRs as issues, but note: **PRs don't support reactions directly**. The correct approach for PR events is to skip reaction (there's no comment to react to) OR react to the PR body via the Issues API. However, GitHub does NOT support reactions on pull request bodies through the Issues reactions endpoint -- only on issue bodies and comments. The best UX for PR open events is to skip the reaction entirely (the summary comment itself serves as acknowledgment) or post a lightweight tracking comment first and react to that.

**Recommendation:** For mention handler: add eyes reaction to the trigger comment. For review handler: skip reaction (no comment to react to) OR post a minimal tracking comment. Given that the review handler already starts processing promptly and will post a summary comment, skipping the reaction for PR events is the simplest correct approach.

```typescript
// In mention handler, BEFORE tracking comment and job enqueue:
try {
  const octokit = await githubApp.getInstallationOctokit(event.installationId);

  if (mention.surface === "pr_review_comment") {
    // PR review comments use a different endpoint
    await octokit.rest.reactions.createForPullRequestReviewComment({
      owner: mention.owner,
      repo: mention.repo,
      comment_id: mention.commentId,
      content: "eyes",
    });
  } else {
    // issue_comment, pr_comment, pr_review_body all use issue comment endpoint
    await octokit.rest.reactions.createForIssueComment({
      owner: mention.owner,
      repo: mention.repo,
      comment_id: mention.commentId,
      content: "eyes",
    });
  }
} catch (err) {
  // Non-fatal: don't block processing if reaction fails
  logger.warn({ err }, "Failed to add eyes reaction");
}
```

**Source:** [GitHub REST API - Reactions](https://docs.github.com/en/rest/reactions/reactions)

### Pattern 2: Collapse Long Responses with `<details>` (UX-03)

**What:** Wrap bot responses longer than a threshold (e.g., 500 characters) in `<details>` tags.

**When to use:** Any comment body that Kodiai posts or updates.

**Approach:** There are two integration points:

1. **Mention responses**: Claude writes responses via MCP `update_comment` tool. The prompt should instruct Claude to wrap long responses in `<details>` tags. This is a prompt-level instruction -- Claude formats its own output.

2. **Error comments and tracking comments**: These are posted by handler code directly. A `wrapInDetails()` utility can be applied before posting.

3. **Review summary comment**: Claude generates this via MCP tool, so prompt instructions handle it.

**GitHub `<details>` syntax (verified):**
```markdown
<details>
<summary>Summary text here</summary>

Content goes here (supports full markdown).

Blank line after `<summary>` tag is required for markdown rendering.

</details>
```

**Key rules:**
- Blank line required between `<summary>` closing tag and content
- Blank line required before `</details>` closing tag
- Markdown renders correctly inside `<details>` blocks
- The `open` attribute makes it expanded by default (don't use for noise reduction)

**Source:** [GitHub Docs - Collapsed Sections](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections)

```typescript
// src/lib/formatting.ts
const COLLAPSE_THRESHOLD = 500; // characters

export function wrapInDetails(
  body: string,
  summaryText?: string,
): string {
  if (body.length <= COLLAPSE_THRESHOLD) return body;

  const summary = summaryText ?? `Response (${body.length} characters)`;
  return [
    `<details>`,
    `<summary>${summary}</summary>`,
    ``,
    body,
    ``,
    `</details>`,
  ].join("\n");
}
```

### Pattern 3: Structured PR Summary Comment (UX-01)

**What:** Post a structured summary comment on each PR review showing what changed, why, and which files were modified.

**When to use:** After Claude completes the review execution in the review handler.

**Approach:** Add instructions to the review prompt telling Claude to post a structured summary comment using the `create_comment` MCP tool. The summary should contain:

1. **What changed** (high-level description of the changes)
2. **Why** (inferred purpose/motivation)
3. **Files modified** (grouped by category if possible)

This is purely a prompt engineering change to `buildReviewPrompt()`. The existing `create_comment` MCP tool already supports posting comments. Currently the review prompt says "Do NOT post a summary comment" -- this needs to change to "Post a structured summary comment."

**Template for Claude's prompt:**
```
## Summary Comment

After reviewing, post ONE summary comment on the PR using the `mcp__github_comment__create_comment` tool with the following structure:

### What Changed
[1-3 sentence high-level description of the changes]

### Why
[Inferred purpose/motivation for the changes]

### Files Modified
[List of modified files, grouped by purpose if applicable]

Keep the summary concise. If the PR is trivial (fewer than 3 files, under 50 lines changed), keep the summary to 2-3 lines total.
```

### Anti-Patterns to Avoid

- **Blocking on reaction failure:** Reaction calls must be fire-and-forget. Never let a reaction API failure prevent the main processing flow.
- **Wrapping already-wrapped content:** The `wrapInDetails()` utility must check for existing `<details>` tags to avoid double-wrapping.
- **Making summary comments too verbose:** The summary should be shorter than the diff, not a restatement of it. Prompt must emphasize brevity.
- **Reacting to PR events via Issues API:** GitHub does not support reactions on PR bodies through the Issues reactions endpoint. Only comments have reaction support.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Emoji reactions | Custom webhook/GraphQL | `octokit.rest.reactions.*` | REST API handles idempotency (returns 200 if already reacted) |
| Collapsed sections | Custom markdown transformer | Raw `<details>`/`<summary>` HTML | GitHub natively supports these tags in all comment surfaces |
| PR summary generation | Rule-based file categorizer | Claude prompt instructions | LLM produces better natural language summaries than template filling |

**Key insight:** All three features are thin integration layers -- reactions are a single API call, `<details>` is raw HTML, and the summary is prompt engineering. No complex logic needed.

## Common Pitfalls

### Pitfall 1: Reaction Endpoint Mismatch
**What goes wrong:** Using `createForIssueComment` for PR review comments (different API endpoint).
**Why it happens:** GitHub's PR review comments and issue comments use different REST endpoints even though they're both "comments."
**How to avoid:** Check `mention.surface` to determine which reaction endpoint to call: `pr_review_comment` uses `createForPullRequestReviewComment`, all others use `createForIssueComment`.
**Warning signs:** 404 errors when adding reactions to PR review comments.

### Pitfall 2: Review Body Reactions
**What goes wrong:** Trying to react to a PR review body (`pull_request_review.submitted`).
**Why it happens:** The review body's `commentId` is actually a review ID, not a comment ID. The reaction endpoints expect comment IDs.
**How to avoid:** For `pr_review_body` surface, the review ID cannot be used with the standard reaction endpoints. Either skip the reaction or use the pull request review comment reaction endpoint if a review comment ID is available. The safest approach is: for `pr_review_body`, skip the reaction (the review body is not a standard comment).
**Warning signs:** 404 or validation errors when trying to add reactions.

### Pitfall 3: `<details>` Tag Without Blank Lines
**What goes wrong:** Markdown inside `<details>` renders as raw text.
**Why it happens:** GitHub's markdown renderer requires blank lines between HTML tags and markdown content.
**How to avoid:** Always include blank lines after `<summary>` and before `</details>`.
**Warning signs:** Content appears as plain text instead of formatted markdown.

### Pitfall 4: Summary Comment Conflicting with "No Summary" Rule
**What goes wrong:** The current review prompt says "Do NOT post a summary comment." Adding a summary comment instruction contradicts this.
**Why it happens:** Phase 4 deliberately avoided summary comments to keep reviews clean.
**How to avoid:** Replace the "no summary" instruction with the structured summary instruction. The new summary replaces the old prohibition, it's not added alongside it.
**Warning signs:** Claude posting both inline comments AND refusing to post a summary, or posting duplicate summaries.

### Pitfall 5: Double-Wrapping in `<details>`
**What goes wrong:** Content that already contains `<details>` tags gets wrapped again, producing nested collapsed sections.
**Why it happens:** The utility function blindly wraps based on length without checking existing tags.
**How to avoid:** Check for existing `<details>` at the start of the body before wrapping.
**Warning signs:** Users see nested "click to expand" sections.

### Pitfall 6: Reaction on Clean PR with No Action
**What goes wrong:** Adding an eyes reaction to a PR that ends up being skipped (draft, disabled config, skipAuthors).
**Why it happens:** If the reaction fires before skip checks, users see eyes on PRs that get no review.
**How to avoid:** For the review handler, don't add a reaction at all (there's no comment to react to anyway). For mentions, the reaction fires before skip checks, which is actually correct -- it confirms "I saw your message" even if the bot later decides not to act.
**Warning signs:** Users confused by eyes emoji on PRs that receive no review.

## Code Examples

Verified patterns from official sources and the existing codebase:

### Adding Eyes Reaction to Issue Comment
```typescript
// Source: GitHub REST API docs + verified in @octokit/rest v22
// Available at: octokit.rest.reactions.createForIssueComment
await octokit.rest.reactions.createForIssueComment({
  owner: "owner",
  repo: "repo",
  comment_id: 12345,
  content: "eyes",
});
// Returns 201 Created (new reaction) or 200 OK (already exists -- idempotent)
```

### Adding Eyes Reaction to PR Review Comment
```typescript
// Source: GitHub REST API docs + verified in @octokit/rest v22
await octokit.rest.reactions.createForPullRequestReviewComment({
  owner: "owner",
  repo: "repo",
  comment_id: 12345,
  content: "eyes",
});
```

### Wrapping Content in `<details>` Tags
```typescript
// Utility function for collapsing long responses
export function wrapInDetails(body: string, summaryText?: string): string {
  if (body.length <= 500) return body;
  if (body.trimStart().startsWith("<details>")) return body; // Already wrapped

  const summary = summaryText ?? `Kodiai response (${body.length} characters)`;
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}
```

### Supported Reaction Content Values
```typescript
// Source: GitHub REST API docs
// All valid values for the `content` parameter:
type ReactionContent =
  | "+1"      // thumbs up
  | "-1"      // thumbs down
  | "laugh"   // laughing face
  | "confused" // confused face
  | "heart"   // heart
  | "hooray"  // celebration
  | "rocket"  // rocket
  | "eyes";   // eyes (used for acknowledgment)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GitHub Reactions API v3 (preview) | Reactions API v3 (stable) | 2020+ | No preview Accept header needed; fully stable |
| No `<details>` in comments | `<details>`/`<summary>` fully supported | 2016+ | Universal support in all GitHub comment surfaces |
| Template-based PR summaries | LLM-generated structured summaries | 2024+ | Natural language summaries are more readable and contextual |

**Deprecated/outdated:**
- The Reactions API preview media type (`squirrel-girl-preview`) is no longer needed -- reactions are GA.

## Open Questions

1. **Review handler reaction target**
   - What we know: PR open events don't have a comment to react to. Only comments support reactions.
   - What's unclear: Should the review handler post a lightweight "reviewing..." comment before enqueue just to have a reaction target?
   - Recommendation: Skip reaction for review handler. The structured summary comment itself is the acknowledgment. Adding a tracking comment to the review flow adds unnecessary noise. The success criterion says "trigger comment/event receives an eyes emoji reaction" -- for PR events where there's no trigger comment, the summary comment IS the acknowledgment.

2. **`<details>` threshold for mention vs review responses**
   - What we know: Success criteria says "e.g., 500 characters."
   - What's unclear: Should the threshold differ between mention responses (conversational) and review summaries (structured)?
   - Recommendation: Use 500 characters for all responses. The `<details>` wrapping should be a prompt instruction for Claude-generated content, and a utility function for handler-generated content (error comments).

3. **Summary comment placement relative to inline comments**
   - What we know: The summary should appear "at the top" of the review.
   - What's unclear: If Claude posts inline comments first, the summary comment appears below them chronologically.
   - Recommendation: Instruct Claude to post the summary comment FIRST, before any inline comments. This way it appears at the top of the PR conversation timeline.

## Sources

### Primary (HIGH confidence)
- `@octokit/rest` v22.0.1 installed in project -- `reactions.createForIssueComment`, `createForPullRequestReviewComment`, `createForIssue` confirmed via type definitions in `node_modules/@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types.d.ts`
- [GitHub REST API - Reactions](https://docs.github.com/en/rest/reactions/reactions) -- endpoints, supported content values (`eyes`, `+1`, etc.), permission requirements
- [GitHub Docs - Collapsed Sections](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections) -- `<details>`/`<summary>` syntax, blank line requirements
- Existing codebase: `src/handlers/review.ts`, `src/handlers/mention.ts`, `src/execution/review-prompt.ts`, `src/execution/mcp/comment-server.ts` -- verified integration points

### Secondary (MEDIUM confidence)
- [Octokit REST API reference](https://actions-cool.github.io/octokit-rest/en-US/api/reactions/) -- method signatures for reaction endpoints
- [GitHub App Permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps) -- reaction creation requires Issues:write (for issue comments) and Pull requests:write (for PR review comments)

### Tertiary (LOW confidence)
- None -- all claims verified with primary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- verified `@octokit/rest` type definitions in node_modules, confirmed all reaction methods exist
- Architecture: HIGH -- all integration points examined in existing codebase; changes are thin layers on existing patterns
- Pitfalls: HIGH -- endpoint mismatch and blank-line issues are well-documented; verified against GitHub official docs

**Research date:** 2026-02-08
**Valid until:** 2026-03-08 (stable APIs, no anticipated breaking changes)
