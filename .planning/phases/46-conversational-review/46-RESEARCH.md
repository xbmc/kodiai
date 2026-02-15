# Phase 46: Conversational Review - Research

**Researched:** 2026-02-14
**Domain:** GitHub webhook comment threading, conversation context assembly, rate limiting, mention sanitization
**Confidence:** HIGH

## Summary

Phase 46 transforms Kodiai's mention handler from a one-shot Q&A system into a multi-turn conversational partner for review findings. The core mechanism is: when a user replies to a Kodiai review finding comment with `@kodiai`, the bot detects the reply context, loads the original finding metadata (severity, category, file, line, title), assembles the review comment thread history, and responds with a contextual follow-up.

The existing codebase already has 90% of the infrastructure needed. The mention handler (`src/handlers/mention.ts`) already processes `pull_request_review_comment.created` webhooks, normalizes them via `normalizeReviewComment()`, builds conversation context via `buildMentionContext()`, and replies in-thread via `createReplyForReviewComment()`. The gap is narrow: (1) the `in_reply_to_id` field from the webhook payload is not extracted into `MentionEvent`, (2) `buildMentionContext()` only fetches issue-level comments, not review comment thread history, (3) there is no mechanism to look up the original finding from the knowledge store by `comment_id`, (4) no conversation-specific rate limiting exists, (5) outgoing bot replies are not sanitized to strip self-mentions, and (6) there is no conversation-specific context budget.

**Primary recommendation:** Extend the existing mention handler pipeline with thread-aware context building. Do NOT create a separate "conversation handler" -- this is an enhancement to `buildMentionContext()` and `buildMentionPrompt()`, gated by the presence of `in_reply_to_id` on the triggering comment.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@octokit/rest` | 22.0.1 | GitHub API calls: fetch parent comment, list review comments, post replies | Already used throughout codebase |
| `@octokit/webhooks-types` | 7.6.1 | Type definitions including `in_reply_to_id` on `PullRequestReviewComment` | Already used; `in_reply_to_id?: number` confirmed at line 6751 of schema.d.ts |
| `bun:sqlite` | (bundled) | Knowledge store for finding lookup by `comment_id` | Already used in `src/knowledge/store.ts` |
| `zod` | (existing) | Config schema for conversation limits | Already used in `src/execution/config.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `p-queue` | (existing) | Job queue concurrency control | Already used; no changes needed |
| `picomatch` | (existing) | Glob matching if needed for path filters | Already available |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| REST API for thread reconstruction | GraphQL API | GraphQL could fetch thread in one call, but REST is already used everywhere and sufficient |
| SQLite conversation state | Ephemeral per-request | GitHub IS the persistence layer; storing conversation state locally adds staleness risk |
| New "conversation handler" | Extend existing mention handler | Separate handler duplicates 90% of mention handler code; extension is simpler |

**Installation:**
No new packages needed. All dependencies already exist.

## Architecture Patterns

### Recommended Changes

```
src/
├── handlers/
│   ├── mention.ts             # Minor: pass knowledgeStore to buildMentionContext
│   └── mention-types.ts       # Add: inReplyToId field to MentionEvent
├── execution/
│   ├── mention-context.ts     # Major: add thread-aware context building
│   └── mention-prompt.ts      # Minor: add finding-specific prompt section
├── knowledge/
│   ├── types.ts               # Add: getFindinByCommentId method signature
│   └── store.ts               # Add: getFindinByCommentId query
├── lib/
│   └── sanitizer.ts           # Add: sanitizeOutgoingMention utility
└── execution/
    └── config.ts              # Add: mention.conversation config section
```

### Pattern 1: Thread Context Reconstruction via `in_reply_to_id`

**What:** When a `pull_request_review_comment.created` event fires and the comment has `in_reply_to_id` set, the triggering comment is a reply in an existing review thread. The handler should: (1) fetch the parent comment via `pulls.getReviewComment`, (2) determine if the parent is a Kodiai finding (check for review output marker `<!-- kodiai:review-output-key:... -->`), (3) fetch the full thread via `pulls.listReviewComments` filtered to the same thread root, (4) include thread history in the mention context.

**When to use:** Every time `mention.surface === "pr_review_comment"` and `mention.inReplyToId` is defined.

**Example:**
```typescript
// Source: @octokit/webhooks-types schema.d.ts line 6751 + GitHub REST API docs
// In normalizeReviewComment():
inReplyToId: payload.comment.in_reply_to_id ?? undefined,

// In buildMentionContext(), new section:
if (mention.inReplyToId && mention.prNumber) {
  // Fetch parent comment
  const { data: parent } = await octokit.rest.pulls.getReviewComment({
    owner: mention.owner,
    repo: mention.repo,
    comment_id: mention.inReplyToId,
  });

  // Check if parent is a kodiai finding
  const isKodiaiFinding = parent.body?.includes("<!-- kodiai:review-output-key:");

  // Fetch thread comments (all comments with same in_reply_to_id root)
  const { data: threadComments } = await octokit.rest.pulls.listReviewComments({
    owner: mention.owner,
    repo: mention.repo,
    pull_number: mention.prNumber,
    per_page: 100,
  });

  // Filter to thread: same in_reply_to_id chain
  const threadRoot = mention.inReplyToId;
  const inThread = threadComments.filter(
    c => c.id === threadRoot || c.in_reply_to_id === threadRoot
  );
}
```

### Pattern 2: Finding Lookup by Comment ID

**What:** When the parent comment is identified as a Kodiai finding, look up the finding's metadata (severity, category, file, line, title) from the knowledge store to provide richer context than what can be parsed from the comment body alone.

**When to use:** When `isKodiaiFinding` is true and `knowledgeStore` is available.

**Example:**
```typescript
// New method on KnowledgeStore:
getFindingByCommentId(params: {
  repo: string;
  commentId: number;
}): { severity: string; category: string; filePath: string;
       startLine: number | null; title: string } | null;

// SQL:
SELECT severity, category, file_path, start_line, title
FROM findings f
INNER JOIN reviews r ON r.id = f.review_id
WHERE r.repo = $repo AND f.comment_id = $commentId
ORDER BY f.created_at DESC
LIMIT 1
```

### Pattern 3: Outgoing Mention Sanitization

**What:** Before posting any reply, strip `@kodiai`, `@claude`, and the app slug from the outgoing body to prevent the bot from triggering itself. This is defense-in-depth alongside the bot filter.

**When to use:** Every outgoing comment posted by the mention handler.

**Example:**
```typescript
// In lib/sanitizer.ts:
export function sanitizeOutgoingMentions(
  body: string,
  handles: string[],
): string {
  let sanitized = body;
  for (const handle of handles) {
    const clean = handle.startsWith("@") ? handle.slice(1) : handle;
    // Replace @handle with handle (remove the @)
    const regex = new RegExp(`@${escapeRegExp(clean)}\\b`, "gi");
    sanitized = sanitized.replace(regex, clean);
  }
  return sanitized;
}
```

### Pattern 4: Conversation Rate Limiting

**What:** Track per-PR conversation turn count using an in-memory Map (same pattern as `lastWriteAt` in `mention.ts`). Refuse to reply after N turns per PR within a time window.

**When to use:** Before enqueuing a conversation job.

**Example:**
```typescript
// Config schema addition:
const conversationSchema = z.object({
  maxTurnsPerPr: z.number().min(1).max(50).default(10),
  contextBudgetChars: z.number().min(1000).max(50000).default(8000),
}).default({ maxTurnsPerPr: 10, contextBudgetChars: 8000 });

// In mention handler, in-memory tracker:
const prConversationTurns = new Map<string, number>(); // key: "owner/repo/pr#"
```

### Anti-Patterns to Avoid
- **Separate conversation handler:** Do NOT create a new handler class. The mention handler already processes all comment surfaces and has all the context. Add conversation awareness inline.
- **Persistent conversation state:** Do NOT store conversation history in SQLite. GitHub comments ARE the conversation state. Fetching them from the API on each turn is stateless and always current.
- **Unbounded thread fetching:** Do NOT paginate through all review comments for a PR. Cap at 100 comments (1 page). If the thread is longer than that, truncate with a scale note.
- **Re-parsing finding from comment body:** Do NOT regex-parse the finding severity/category from the comment markdown. Use the knowledge store lookup by `comment_id` which has structured data.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Thread reconstruction | Custom thread-walking algorithm | `pulls.listReviewComments` + filter by `in_reply_to_id` | GitHub API handles pagination, permissions, deleted comments |
| Finding metadata lookup | Regex parse of review comment body | `KnowledgeStore.getFindingByCommentId()` | Structured data from SQLite is reliable; comment body format can change |
| Rate limiting | Custom token bucket | In-memory Map with counter (existing pattern from `lastWriteAt`) | Simple, sufficient for single-replica deployment. Maps already have pruning logic. |
| Comment body sanitization | Custom mention stripper | Extend existing `stripMention()` pattern from `mention-types.ts` | Already handles escaping, case insensitivity, multiple handles |
| Context truncation | Custom truncation logic | Extend existing `truncateDeterministic()` from `mention-context.ts` | Already handles deterministic truncation with `...[truncated]` suffix |

**Key insight:** This phase is an integration task, not a greenfield build. Every primitive already exists in the codebase. The work is wiring them together with the new `in_reply_to_id` signal and adding conversation-specific guardrails.

## Common Pitfalls

### Pitfall 1: Self-Trigger Loop (P0 Risk)

**What goes wrong:** Bot posts a reply containing `@kodiai` (e.g., quoting the user's mention, or suggesting "try @kodiai apply:"). The reply triggers a new `pull_request_review_comment.created` event. The bot filter drops events from `kodiai[bot]`, but if the bot's reply body contains `@kodiai`, the mention handler's fast filter at line 172 of `mention.ts` matches -- and if the sender normalization ever fails, an infinite loop begins.
**Why it happens:** The bot filter is the sole protection. Conversational mode increases the surface area for self-triggering because bot replies reference the original mention.
**How to avoid:** Defense-in-depth: (1) sanitize outgoing mentions (strip `@kodiai` and `@claude` from all bot replies), (2) add a comment-author check in the mention handler (refuse to process if `mention.commentAuthor` matches the app slug), (3) add per-PR turn counter with hard cap.
**Warning signs:** Bot posts more than 2 replies to the same thread within 1 minute.

### Pitfall 2: Context Window Explosion on Long Threads

**What goes wrong:** A 10-turn conversation thread generates 20,000+ characters of context. Combined with PR metadata and diff context, total input exceeds 50K tokens. Cost per turn is $0.15+ instead of $0.03.
**Why it happens:** `buildMentionContext()` was designed for one-shot mentions. It includes all conversation comments up to a cap, but does not distinguish between relevant turns and stale history.
**How to avoid:** Separate context budget for conversation thread vs. issue comments. Most recent 2-3 thread turns get full inclusion; older turns get truncated to first sentence. Cap total conversation context at K chars (configurable, default 8000).
**Warning signs:** Mention execution cost exceeds $0.10 or input tokens exceed 20K.

### Pitfall 3: Finding Lookup Returns Nothing for Old Reviews

**What goes wrong:** User replies to a Kodiai finding from a review done before the `comment_id` column was added to the `findings` table. The lookup returns null, and the bot falls back to generic mention behavior instead of finding-aware conversation.
**Why it happens:** The `comment_id` column was added as a migration (`ensureTableColumn` at line 207 of `store.ts`). Old findings have `comment_id = NULL`.
**How to avoid:** Graceful fallback: when finding lookup returns null, still build thread context from the comment body. Parse the review output marker from the parent comment to confirm it is a Kodiai finding, even without structured metadata. Log a warning for debugging.
**Warning signs:** Finding lookup returns null for a comment that contains the review output marker.

### Pitfall 4: Rate Limiter State Lost on Process Restart

**What goes wrong:** The per-PR turn counter uses an in-memory Map. After a deploy or crash, the counter resets. A user who was rate-limited can immediately resume flooding.
**Why it happens:** The existing `lastWriteAt` Map has the same limitation and it is documented as acceptable for the current single-replica deployment.
**How to avoid:** Accept this as a known limitation. The conversation turn limit is a guardrail, not a security boundary. If persistence is needed later, move the counter to SQLite (same as `lastWriteAt` could be migrated).
**Warning signs:** After a deploy, bot replies to a thread that was previously rate-limited.

### Pitfall 5: Issue Comments Misidentified as Review Thread Replies

**What goes wrong:** User posts a top-level PR comment (`issue_comment.created`) that says "@kodiai what about the null check finding?" This is an `issue_comment` surface, NOT a `pr_review_comment`. The issue comment has no `in_reply_to_id`. The handler processes it as a regular mention with no finding context, even though the user's intent is to discuss a review finding.
**Why it happens:** GitHub has two distinct comment systems on PRs: issue comments (top-level) and review comments (inline diff). They are different API surfaces and different webhook events. Users often conflate them.
**How to avoid:** Phase 46 only supports conversation via inline review comment replies (`pr_review_comment` surface with `in_reply_to_id`). Top-level issue comments continue to work as regular mentions. This is a scope boundary, not a bug. Document it clearly and consider expanding in a future phase.
**Warning signs:** Users ask about findings in top-level comments and get generic responses.

## Code Examples

### Example 1: Extracting `in_reply_to_id` in normalizeReviewComment

```typescript
// Source: src/handlers/mention-types.ts + @octokit/webhooks-types schema.d.ts line 6751
export interface MentionEvent {
  // ... existing fields ...
  /** For pr_review_comment: the comment ID this is replying to (thread parent) */
  inReplyToId: number | undefined;
}

export function normalizeReviewComment(
  payload: PullRequestReviewCommentCreatedEvent,
): MentionEvent {
  return {
    // ... existing fields ...
    inReplyToId: payload.comment.in_reply_to_id ?? undefined,
  };
}
```

### Example 2: Thread-Aware Context Building

```typescript
// Source: src/execution/mention-context.ts (new section)
// After existing "Inline Review Comment Context" section:

if (mention.surface === "pr_review_comment" && mention.inReplyToId && mention.prNumber) {
  lines.push("## Review Comment Thread Context");

  // 1. Fetch parent comment
  const { data: parent } = await octokit.rest.pulls.getReviewComment({
    owner: mention.owner,
    repo: mention.repo,
    comment_id: mention.inReplyToId,
  });

  // 2. Determine if parent is a kodiai finding
  const reviewOutputMarkerRe = /<!-- kodiai:review-output-key:[^>]+ -->/;
  const isKodiaiFinding = reviewOutputMarkerRe.test(parent.body ?? "");

  // 3. Include finding metadata if available
  if (isKodiaiFinding && findingLookup) {
    const finding = findingLookup(mention.owner, mention.repo, mention.inReplyToId);
    if (finding) {
      lines.push(`Original finding: [${finding.severity.toUpperCase()}] ${finding.category}`);
      lines.push(`File: ${finding.filePath}`);
      if (finding.startLine) lines.push(`Line: ${finding.startLine}`);
      lines.push(`Title: ${finding.title}`);
      lines.push("");
    }
  }

  // 4. Fetch thread comments (cap at 1 page = 100 comments)
  const { data: allReviewComments } = await octokit.rest.pulls.listReviewComments({
    owner: mention.owner,
    repo: mention.repo,
    pull_number: mention.prNumber,
    per_page: 100,
    sort: "created",
    direction: "asc",
  });

  const threadRoot = mention.inReplyToId;
  const threadComments = allReviewComments.filter(
    c => c.id === threadRoot || c.in_reply_to_id === threadRoot
  );

  // 5. Include thread history (budgeted)
  let threadCharBudget = maxConversationChars; // reuse the conversation budget
  for (const tc of threadComments) {
    if (threadCharBudget <= 0) break;
    const author = tc.user?.login ?? "unknown";
    const body = truncateDeterministic(sanitizeContent(tc.body ?? ""), maxCommentChars);
    threadCharBudget -= body.text.length;
    lines.push(`### @${author} (${tc.created_at})`);
    lines.push(body.text);
    lines.push("");
  }
}
```

### Example 3: Outgoing Mention Sanitization

```typescript
// Source: src/lib/sanitizer.ts (new export)
export function sanitizeOutgoingMentions(
  body: string,
  handles: string[],
): string {
  let result = body;
  for (const handle of handles) {
    const clean = handle.startsWith("@") ? handle.slice(1) : handle;
    if (!clean) continue;
    // Replace @handle with handle (remove the @ to prevent re-trigger)
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`@${escaped}\\b`, "gi"), clean);
  }
  return result;
}
```

### Example 4: Config Schema for Conversation Limits

```typescript
// Source: src/execution/config.ts (addition to mentionSchema)
const mentionSchema = z.object({
  enabled: z.boolean().default(true),
  acceptClaudeAlias: z.boolean().default(true),
  allowedUsers: z.array(z.string()).default([]),
  prompt: z.string().optional(),
  conversation: z.object({
    maxTurnsPerPr: z.number().min(1).max(50).default(10),
    contextBudgetChars: z.number().min(1000).max(50000).default(8000),
  }).default({ maxTurnsPerPr: 10, contextBudgetChars: 8000 }),
}).default({
  enabled: true,
  acceptClaudeAlias: true,
  allowedUsers: [],
  conversation: { maxTurnsPerPr: 10, contextBudgetChars: 8000 },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One-shot mentions only | Conversational follow-up on review findings | Phase 46 | Users can ask clarifying questions about findings without losing context |
| Issue comments only for mention context | Review comment thread context included | Phase 46 | Inline thread replies now carry the full thread history |
| No finding metadata in mention context | Knowledge store lookup by comment_id | Phase 46 | Bot knows the severity, category, file, line of the finding being discussed |
| No outgoing mention sanitization | All bot replies sanitized | Phase 46 | Defense-in-depth against self-trigger loops |
| No conversation rate limiting | Per-PR turn counter with configurable cap | Phase 46 | Prevents runaway token costs from long conversations |

## Open Questions

1. **Thread reconstruction for deeply nested replies**
   - What we know: GitHub review comment threads are flat (all replies have the same `in_reply_to_id` pointing to the thread root). There is no nesting.
   - What's unclear: Are there edge cases where `in_reply_to_id` points to a reply rather than the thread root? The GitHub docs say "The ID of the comment to reply to" which suggests it always points to the root.
   - Recommendation: Code defensively. When looking up the thread, match on `c.id === threadRoot || c.in_reply_to_id === threadRoot`. If the parent comment itself has an `in_reply_to_id`, walk up one level to find the true root.

2. **Conversation turn counting accuracy**
   - What we know: The in-memory counter tracks bot replies per PR. It resets on restart.
   - What's unclear: Should the counter count bot turns only, or all turns (bot + user)? Should it count per-thread or per-PR?
   - Recommendation: Count bot reply turns per PR (not per thread). This is simpler, aligns with cost control (bot turns are the expensive ones), and prevents gaming by creating multiple threads. The config parameter is `maxTurnsPerPr`.

3. **Finding lookup for comments from the current review session**
   - What we know: Findings are recorded in the knowledge store AFTER the review completes (line 2076 of review.ts). If a user replies to a finding within seconds of the review posting, the finding may not yet be in the knowledge store.
   - What's unclear: Is the timing window wide enough to matter in practice? The review handler records findings synchronously before returning.
   - Recommendation: The timing window is likely negligible (findings are recorded before the handler returns, and the user needs time to read and reply). If it becomes an issue, fall back to parsing the comment body.

4. **Handling deleted parent comments**
   - What we know: If the parent comment (the Kodiai finding) has been deleted, `pulls.getReviewComment` returns 404.
   - What's unclear: How often does this happen? Users or admins might delete bot comments.
   - Recommendation: Catch 404 gracefully. If parent is deleted, fall back to regular mention behavior (no finding context). Log a warning.

## Implementation Approach

### Scope: Six Requirements, Three Implementation Tasks

**Task 1: Thread-aware context and finding lookup (CONV-01, CONV-02, CONV-03)**
- Add `inReplyToId` to `MentionEvent` and `normalizeReviewComment()`
- Add `getFindingByCommentId()` to `KnowledgeStore`
- Enhance `buildMentionContext()` with thread context section
- Enhance `buildMentionPrompt()` with finding-specific preamble
- Pass `knowledgeStore` through to context builder
- TDD: test finding lookup, thread filtering, context assembly

**Task 2: Rate limiting and outgoing sanitization (CONV-04, CONV-05)**
- Add `sanitizeOutgoingMentions()` to `lib/sanitizer.ts`
- Apply sanitization to all outgoing comment bodies in mention handler
- Add per-PR conversation turn counter (in-memory Map)
- Add config schema: `mention.conversation.maxTurnsPerPr`
- Add comment-author check as defense-in-depth
- TDD: test sanitization, rate limiting, author check

**Task 3: Context budget and integration (CONV-06)**
- Add `mention.conversation.contextBudgetChars` to config
- Implement conversation-aware budget allocation in `buildMentionContext()`
- Separate thread context budget from issue comment budget
- Recent turns get full allocation; older turns get truncated
- TDD: test budget enforcement, truncation behavior

## Sources

### Primary (HIGH confidence)
- `src/handlers/mention.ts` -- current mention handler, all comment surfaces, reply posting
- `src/handlers/mention-types.ts` -- `MentionEvent` interface, `normalizeReviewComment()`
- `src/execution/mention-context.ts` -- `buildMentionContext()`, conversation history, truncation
- `src/execution/mention-prompt.ts` -- `buildMentionPrompt()`, prompt structure
- `src/knowledge/types.ts` -- `KnowledgeStore` interface, `FindingRecord` type
- `src/knowledge/store.ts` -- SQLite schema, findings table (comment_id column at line 207)
- `src/webhook/filters.ts` -- `createBotFilter()`, self-event detection
- `src/lib/sanitizer.ts` -- `sanitizeContent()`, `filterCommentsToTriggerTime()`
- `src/execution/config.ts` -- config schemas, `mentionSchema`
- `src/execution/mcp/review-comment-thread-server.ts` -- `createReplyForReviewComment` MCP tool
- `node_modules/@octokit/webhooks-types/schema.d.ts` -- `in_reply_to_id` at line 6751
- `src/handlers/review-idempotency.ts` -- `buildReviewOutputMarker()` pattern
- `.planning/research/ARCHITECTURE.md` -- prior research on conversation scope identification
- `.planning/research/STACK.md` -- prior research on thread-aware context, API availability
- `.planning/research/PITFALLS.md` -- P1 (self-trigger loop), P2 (context explosion), P6 (stale context), P9 (queue flooding), P11 (formatting artifacts)

### Secondary (MEDIUM confidence)
- [GitHub REST API: Pull Request Review Comments](https://docs.github.com/en/rest/pulls/comments) -- `in_reply_to_id` field, thread reply endpoint
- [GitHub Webhook Events and Payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads) -- `pull_request_review_comment.created` payload structure
- [GitHub REST API Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) -- 80 content-creation requests/minute

### Tertiary (LOW confidence)
- `in_reply_to_id` always points to thread root (not intermediate replies) -- inferred from GitHub docs but not explicitly tested with production data

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- integration points identified precisely with line numbers, prior research validated against current codebase
- Pitfalls: HIGH -- five pitfalls documented with prevention strategies, most from prior research validated against current code
- Finding lookup: MEDIUM -- `comment_id` column exists but old findings may have NULLs; graceful fallback needed

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (stable domain, no external dependency changes expected)
