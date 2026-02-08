# Phase 6: Content Safety - Research

**Researched:** 2026-02-08
**Domain:** Content sanitization, prompt injection prevention, TOCTOU mitigation
**Confidence:** HIGH

## Summary

Phase 6 adds two security layers to Kodiai: (1) content sanitization that strips prompt injection vectors from all user-generated content before it reaches the LLM, and (2) TOCTOU timestamp filtering that ensures only comments existing at trigger time are included in conversation context.

The reference implementation (`claude-code-action`) already contains battle-tested sanitization code in `tmp/claude-code-action/src/github/utils/sanitizer.ts` with comprehensive tests. This code is a direct port target -- pure string manipulation with no dependencies, using well-characterized regex patterns for each attack vector. The TOCTOU filtering functions in `tmp/claude-code-action/src/github/data/fetcher.ts` are similarly self-contained and thoroughly tested.

**Primary recommendation:** Port the sanitizer and TOCTOU filter from the reference action as standalone utility modules, then integrate them at the prompt-building and context-fetching boundaries in the existing codebase. No external libraries needed -- this is all regex-based string processing.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none) | - | Content sanitization is pure regex/string manipulation | No dependencies needed; reference code proves this approach works |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bun:test | built-in | Testing sanitizer and TOCTOU filters | Unit tests for all sanitization rules |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom regex sanitizer | DOMPurify / sanitize-html | Overkill -- we are sanitizing markdown/text for LLM consumption, not rendering HTML safely. DOMPurify targets browser DOM injection, not prompt injection. |
| Timestamp filtering in JS | GitHub API `since` param | The `since` param on `listComments` filters by `updated_at >= since`, not `created_at < since`. It does not exclude comments edited after a timestamp. Client-side filtering is required. |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── lib/
│   └── sanitizer.ts          # Content sanitization functions (new)
│   └── sanitizer.test.ts     # Tests (new)
├── execution/
│   └── mention-prompt.ts     # Modified: sanitize comment bodies + TOCTOU filter
│   └── review-prompt.ts      # Modified: sanitize PR title/body
│   └── prompt.ts             # Modified: sanitize triggerBody
└── handlers/
    └── mention.ts            # Modified: pass commentCreatedAt for TOCTOU
```

### Pattern 1: Sanitize at the Boundary

**What:** Apply sanitization where user content first enters the prompt pipeline, not inside the sanitizer itself.
**When to use:** Every time user-generated text (comment bodies, PR titles, PR bodies, diff hunks) is incorporated into a prompt string.
**Why:** A single `sanitizeContent()` call at the boundary prevents all downstream code from needing to worry about injection. The reference action applies sanitization in the formatter (the equivalent of our prompt builders).

```typescript
// Source: tmp/claude-code-action/src/github/data/formatter.ts
// Pattern: sanitize when formatting, not when fetching
export function formatBody(body: string, imageUrlMap: Map<string, string>): string {
  let processedBody = body;
  for (const [originalUrl, localPath] of imageUrlMap) {
    processedBody = processedBody.replaceAll(originalUrl, localPath);
  }
  processedBody = sanitizeContent(processedBody);
  return processedBody;
}
```

**In Kodiai:** Apply `sanitizeContent()` in `buildConversationContext()` on each comment body, in `buildMentionPrompt()` on the user question, and in `buildReviewPrompt()` on PR title/body.

### Pattern 2: TOCTOU Filter Before Context Building

**What:** Filter comments by comparing their `created_at` and `updated_at` timestamps against the trigger comment's `created_at` timestamp, excluding any comment that was created at/after the trigger or edited at/after the trigger.
**When to use:** In `buildConversationContext()` before iterating over comments.
**Why:** Prevents an attacker from posting or editing comments between the trigger event and when the bot fetches conversation context.

```typescript
// Source: tmp/claude-code-action/src/github/data/fetcher.ts
export function filterCommentsToTriggerTime<
  T extends { createdAt: string; updatedAt?: string; lastEditedAt?: string },
>(comments: T[], triggerTime: string | undefined): T[] {
  if (!triggerTime) return comments;
  const triggerTimestamp = new Date(triggerTime).getTime();
  return comments.filter((comment) => {
    const createdTimestamp = new Date(comment.createdAt).getTime();
    if (createdTimestamp >= triggerTimestamp) return false;
    const lastEditTime = comment.lastEditedAt || comment.updatedAt;
    if (lastEditTime) {
      const lastEditTimestamp = new Date(lastEditTime).getTime();
      if (lastEditTimestamp >= triggerTimestamp) return false;
    }
    return true;
  });
}
```

**Adaptation for Kodiai:** Our REST API returns `created_at` and `updated_at` (no `lastEditedAt` -- that is a GraphQL-only field). Use `updated_at` as the edit timestamp. The filter uses strict less-than (`<`, not `<=`) against the trigger timestamp -- comments created at exactly the trigger time are excluded for security.

### Pattern 3: Layered Sanitization Pipeline

**What:** Chain multiple sanitization steps in a specific order.
**When to use:** Always, in the `sanitizeContent()` function.
**Why:** Each step targets a different injection vector. Order matters -- HTML comments must be stripped before entity normalization, otherwise `<!--&#72;-->` might partially survive.

The reference implementation's pipeline order:
1. Strip HTML comments (`<!-- ... -->`)
2. Strip invisible Unicode characters (zero-width, control chars, soft hyphens, bidi overrides)
3. Strip markdown image alt text (`![hidden text](url)` -> `![](url)`)
4. Strip markdown link titles (`[text](url "hidden title")` -> `[text](url)`)
5. Strip hidden HTML attributes (alt, title, aria-label, data-*, placeholder)
6. Normalize HTML entities (decode printable, remove non-printable)
7. Redact GitHub tokens (ghp_, gho_, ghs_, ghr_, github_pat_)

### Anti-Patterns to Avoid

- **Sanitizing output instead of input:** Sanitize content BEFORE it enters the prompt, not after Claude responds. Claude's response doesn't need sanitization (it is generated, not user-controlled).
- **Selective sanitization:** Do NOT sanitize some fields but not others. Every user-generated string must go through `sanitizeContent()`.
- **Over-sanitizing code blocks:** The sanitizer should work on GitHub comment/issue/PR body text. It intentionally does NOT try to parse code blocks specially -- hidden content in code blocks is still a valid injection vector because the LLM reads it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unicode invisible char detection | Custom char-by-char scanner | Reference regex patterns from `sanitizer.ts` | The reference covers 5 distinct categories (zero-width, control, soft hyphen, bidi) with battle-tested regex |
| GitHub token patterns | Loose string matching | Reference `redactGitHubTokens()` with exact prefix/length patterns | Token formats are documented by GitHub with specific prefixes (ghp_, gho_, ghs_, ghr_, github_pat_) and lengths |
| HTML comment stripping | Custom parser | `content.replace(/<!--[\s\S]*?-->/g, "")` | Single regex handles multi-line HTML comments correctly |
| Timestamp comparison | Custom date math | `new Date(iso).getTime()` comparison | ISO 8601 timestamps from GitHub are well-formed; `Date` parsing handles all variants (Z, +00:00, milliseconds) |

**Key insight:** The reference implementation's sanitizer is 100 lines of pure regex. It has no dependencies, no state, and comprehensive test coverage. Porting it is faster and safer than reinventing it.

## Common Pitfalls

### Pitfall 1: REST API `updated_at` vs GraphQL `lastEditedAt`

**What goes wrong:** The reference code uses GraphQL's `lastEditedAt` (only changes on user edits) alongside `updatedAt` (changes on reactions, labels, etc). Our REST API only has `updated_at`, which is equivalent to GraphQL's `updatedAt` -- it changes on ANY update, not just body edits.
**Why it happens:** Different GitHub APIs expose different granularity of timestamp data.
**How to avoid:** Use `updated_at` from REST API as the edit check. This is more conservative -- a comment with a reaction added after trigger time will be filtered out. This is acceptable because: (1) it errs on the side of security, and (2) it is rare for comments to get reactions in the seconds between trigger and context fetch.
**Warning signs:** Tests that rely on `lastEditedAt` behavior will need adjustment.

### Pitfall 2: Forgetting to Sanitize PR Review Data

**What goes wrong:** The review handler passes `prTitle`, `prBody`, and `changedFiles` into the prompt. The PR title and body are user-generated and can contain hidden content. The mention handler passes `userQuestion` and `conversationContext` which contain user comment text.
**Why it happens:** It is easy to only sanitize comment bodies and forget about PR metadata.
**How to avoid:** Audit all user-generated strings flowing into prompts:
  - `buildReviewPrompt()`: sanitize `prTitle`, `prBody`
  - `buildMentionPrompt()`: sanitize `userQuestion` (already stripped of @mention)
  - `buildConversationContext()`: sanitize each `comment.body`, sanitize `pr.body`, sanitize `pr.title`
  - `buildPrompt()` (generic): sanitize `triggerBody`
**Warning signs:** Any prompt builder function that takes a user string without calling `sanitizeContent()`.

### Pitfall 3: HTML Entity Decode Order

**What goes wrong:** If HTML entities are decoded BEFORE HTML comments are stripped, an attacker could use `&lt;!-- hidden --&gt;` to bypass the comment stripper, then the decoded content survives.
**Why it happens:** Incorrect sanitization step ordering.
**How to avoid:** Follow the reference order exactly: strip HTML comments FIRST, normalize entities LAST (except token redaction which is final).

### Pitfall 4: The Trigger Comment Itself

**What goes wrong:** The trigger comment (the one with `@kodiai`) should NOT be included in the TOCTOU-filtered conversation context. It already enters the prompt via `userQuestion` / `triggerBody`. Including it again via the comment list would create duplication and potentially bypass sanitization.
**Why it happens:** The trigger comment's `created_at` equals the `triggerTime`, so `createdTimestamp >= triggerTimestamp` correctly excludes it. However, if using `>` instead of `>=`, the trigger comment would be included.
**How to avoid:** Use strict `>=` comparison (not `>`), consistent with the reference implementation. This excludes the trigger comment and any comments created at exactly the same timestamp.

### Pitfall 5: Diff Hunk Content

**What goes wrong:** For `pr_review_comment` mentions, the `mention.diffHunk` contains diff content from the repo. This is code, not user input -- it comes from the git diff, not from a user-editable field. However, it IS included in the prompt.
**Why it happens:** Diff hunks are generated by git, not composed by users. They reflect actual code content.
**How to avoid:** Do NOT sanitize diff hunks. They contain legitimate code that may include HTML-like syntax, invisible characters in strings, etc. Sanitizing would corrupt the code context. Diff hunks are safe because they come from the git diff, not from user-editable GitHub fields.

## Code Examples

Verified patterns from the reference implementation:

### Content Sanitizer (complete pipeline)

```typescript
// Source: tmp/claude-code-action/src/github/utils/sanitizer.ts
// Port this as src/lib/sanitizer.ts

export function sanitizeContent(content: string): string {
  content = stripHtmlComments(content);
  content = stripInvisibleCharacters(content);
  content = stripMarkdownImageAltText(content);
  content = stripMarkdownLinkTitles(content);
  content = stripHiddenAttributes(content);
  content = normalizeHtmlEntities(content);
  content = redactGitHubTokens(content);
  return content;
}

export const stripHtmlComments = (content: string) =>
  content.replace(/<!--[\s\S]*?-->/g, "");

export function stripInvisibleCharacters(content: string): string {
  // Zero-width chars (ZWSP, ZWNJ, ZWJ, BOM)
  content = content.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
  // Control chars (excluding tab \u0009, newline \u000A, carriage return \u000D)
  content = content.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ""
  );
  // Soft hyphens
  content = content.replace(/\u00AD/g, "");
  // Bidi overrides and isolates
  content = content.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
  return content;
}

export function redactGitHubTokens(content: string): string {
  content = content.replace(/\bghp_[A-Za-z0-9]{36}\b/g, "[REDACTED_GITHUB_TOKEN]");
  content = content.replace(/\bgho_[A-Za-z0-9]{36}\b/g, "[REDACTED_GITHUB_TOKEN]");
  content = content.replace(/\bghs_[A-Za-z0-9]{36}\b/g, "[REDACTED_GITHUB_TOKEN]");
  content = content.replace(/\bghr_[A-Za-z0-9]{36}\b/g, "[REDACTED_GITHUB_TOKEN]");
  content = content.replace(/\bgithub_pat_[A-Za-z0-9_]{11,221}\b/g, "[REDACTED_GITHUB_TOKEN]");
  return content;
}
```

### TOCTOU Comment Filter (adapted for REST API)

```typescript
// Adaptation of: tmp/claude-code-action/src/github/data/fetcher.ts
// Port as src/lib/sanitizer.ts (alongside content sanitizer)

/**
 * Filter comments to only include those that existed before the trigger time.
 * Uses strict < comparison -- comments at or after trigger time are excluded.
 *
 * REST API note: We only have `updated_at` (not GraphQL's `lastEditedAt`).
 * `updated_at` changes on any update (edits, reactions, labels), making this
 * more conservative than the reference implementation. This is acceptable
 * as it errs on the side of security.
 */
export function filterCommentsToTriggerTime(
  comments: Array<{ created_at: string; updated_at?: string }>,
  triggerTime: string | undefined,
): Array<{ created_at: string; updated_at?: string }> {
  if (!triggerTime) return comments;
  const triggerTs = new Date(triggerTime).getTime();
  return comments.filter((c) => {
    if (new Date(c.created_at).getTime() >= triggerTs) return false;
    if (c.updated_at && new Date(c.updated_at).getTime() >= triggerTs) return false;
    return true;
  });
}
```

### Integration Point: buildConversationContext

```typescript
// Modified mention-prompt.ts -- key changes marked with //NEW
import { sanitizeContent, filterCommentsToTriggerTime } from "../lib/sanitizer.ts";

export async function buildConversationContext(
  octokit: Octokit,
  mention: MentionEvent,
): Promise<string> {
  const lines: string[] = [];

  const { data: comments } = await octokit.rest.issues.listComments({
    owner: mention.owner,
    repo: mention.repo,
    issue_number: mention.issueNumber,
    per_page: 30,
  });

  // NEW: TOCTOU filter -- exclude comments created/edited after trigger
  const safeComments = filterCommentsToTriggerTime(comments, mention.commentCreatedAt);

  lines.push("## Conversation History");
  for (const comment of safeComments) {
    if (comment.body?.startsWith('> **Kodiai**')) continue;
    lines.push(`### @${comment.user?.login} (${comment.created_at}):`);
    // NEW: sanitize each comment body
    lines.push(sanitizeContent(comment.body ?? "(empty)"));
    lines.push("");
  }
  // ... rest unchanged
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No sanitization | Layered sanitization pipeline | claude-code-action v1.0+ | Prevents most prompt injection vectors |
| Trust all comments | TOCTOU timestamp filtering | claude-code-action 2025 | Prevents race condition attacks where attacker injects content between trigger and processing |
| Strip HTML comments only | Full pipeline (7 steps) | claude-code-action 2025 | Covers bidi attacks, entity encoding, hidden attributes, alt text injection |

**Not needed for v1:**
- Image download / alt text replacement (Kodiai does not download images from comments)
- Actor-based comment filtering (not in requirements)

## Integration Points Audit

All locations where user content enters prompts, requiring sanitization:

| File | Function | User Content | Action |
|------|----------|--------------|--------|
| `execution/mention-prompt.ts` | `buildConversationContext` | `comment.body` | Sanitize each body + TOCTOU filter |
| `execution/mention-prompt.ts` | `buildConversationContext` | `pr.body`, `pr.title` | Sanitize PR metadata |
| `execution/mention-prompt.ts` | `buildMentionPrompt` | `userQuestion` | Sanitize user question |
| `execution/review-prompt.ts` | `buildReviewPrompt` | `prTitle`, `prBody` | Sanitize PR title and body |
| `execution/prompt.ts` | `buildPrompt` | `triggerBody` | Sanitize trigger body |
| `handlers/mention.ts` | `handleMention` | `mention.commentBody` (used in containsMention/stripMention) | Do NOT sanitize before mention detection -- invisible chars could break @mention matching. Sanitize after stripMention via the prompt builders. |

**TOCTOU filtering applies only to mention flow** (the only place where conversation context is fetched from the API). PR auto-review does not fetch comments, so no TOCTOU concern there.

## Open Questions

1. **Should PR body from webhook payload be preferred over API-fetched body?**
   - What we know: The reference code uses `originalBody` from the webhook payload as TOCTOU protection for the issue/PR body itself. Our PR review handler gets `pr.body` from the webhook event payload, which is already the body at event time. The mention handler gets `mention.commentBody` from the webhook payload. Both are safe.
   - What's unclear: Should we also validate that the PR body hasn't been edited when building mention context (we fetch `pr.body` via `pulls.get()` which returns current state)?
   - Recommendation: For v1, accept this minor risk. The mention handler already has the trigger comment body from the webhook. The PR body fetched via `pulls.get()` is a secondary context item, not the primary prompt content. Add a TODO comment for a future enhancement to use webhook-payload PR body.

## Sources

### Primary (HIGH confidence)
- `tmp/claude-code-action/src/github/utils/sanitizer.ts` -- Complete sanitizer implementation, 101 lines
- `tmp/claude-code-action/test/sanitizer.test.ts` -- 329 lines of sanitizer unit tests
- `tmp/claude-code-action/test/integration-sanitization.test.ts` -- Integration tests for sanitization pipeline
- `tmp/claude-code-action/src/github/data/fetcher.ts` -- TOCTOU filter functions (filterCommentsToTriggerTime, filterReviewsToTriggerTime, isBodySafeToUse)
- `tmp/claude-code-action/test/data-fetcher.test.ts` -- 1431 lines of TOCTOU filter tests
- `tmp/claude-code-action/docs/security.md` -- Security documentation covering sanitization and prompt injection risks

### Secondary (MEDIUM confidence)
- [GitHub REST API - List issue comments](https://docs.github.com/en/rest/issues/comments) -- Confirmed `since`, `created_at`, `updated_at` fields; no `lastEditedAt` equivalent in REST

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Direct port from reference implementation with comprehensive tests
- Architecture: HIGH -- Integration points clearly identified from existing codebase analysis
- Pitfalls: HIGH -- REST vs GraphQL timestamp difference identified and documented with mitigation
- TOCTOU approach: HIGH -- Proven pattern from reference with extensive test coverage

**Research date:** 2026-02-08
**Valid until:** 2026-03-08 (stable -- regex patterns and GitHub API are unlikely to change)
