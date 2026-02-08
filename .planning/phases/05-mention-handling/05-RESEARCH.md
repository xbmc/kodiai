# Phase 5: Mention Handling - Research

**Researched:** 2026-02-08
**Domain:** GitHub webhook event mapping for comment surfaces, conversation context building, tracking comment lifecycle, mention prompt engineering
**Confidence:** HIGH

## Summary

Phase 5 wires the execution engine (Phase 3) to mention-triggered workflows across four distinct GitHub comment surfaces. Each surface maps to a different webhook event with a different payload shape, but they all share the same core flow: detect `@kodiai` in the comment body, post a tracking comment showing progress, build conversation context (prior comments, PR diff if applicable), invoke Claude via the executor, and finalize the tracking comment.

The critical complexity in this phase is the **four-surface mapping**. GitHub uses different webhook events for different comment types:
1. **Issue comments** (both on issues and PRs): `issue_comment.created` -- the `issue.pull_request` field distinguishes PR comments from pure issue comments.
2. **PR review comments** (inline diff comments): `pull_request_review_comment.created` -- these are code-specific comments attached to diff lines.
3. **PR review bodies** (the overall review comment): `pull_request_review.submitted` -- the `review.body` contains the mention.

The established handler factory pattern (`createXxxHandler(deps)`) from Phase 4 applies directly. A single `createMentionHandler(deps)` registers for all three webhook event keys and dispatches to a common execution flow after normalizing each surface's payload into a unified shape. The comment MCP server needs expansion: currently it only has `update_comment`; for mentions, Claude needs `create_comment` (to post issue/PR comments) and `create_review_comment_reply` (to reply in review comment threads).

For the tracking comment, the handler posts a "thinking" comment immediately (before queuing the job), then passes the comment ID to the executor so Claude can update it with the final response via the existing `update_comment` MCP tool. This create-then-update pattern avoids the need for post-execution comment posting by the handler itself -- Claude writes its response directly into the tracking comment.

**Primary recommendation:** Build a single mention handler that registers for `issue_comment.created`, `pull_request_review_comment.created`, and `pull_request_review.submitted`, normalizes each payload into a common `MentionEvent` shape, posts a tracking comment immediately, builds conversation context from prior comments (and PR diff for PR surfaces), and runs the executor with a mention-specific prompt that instructs Claude to update the tracking comment with its response.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@octokit/rest` | `^22.0.1` | GitHub REST API (comments CRUD, PR data) | Already in project; all comment operations go through Octokit |
| `@octokit/webhooks-types` | `^7.6.1` | TypeScript types for webhook payloads | Already in devDependencies; provides `IssueCommentCreatedEvent`, `PullRequestReviewCommentCreatedEvent`, `PullRequestReviewSubmittedEvent` |
| `@anthropic-ai/claude-agent-sdk` | `^0.2.37` | Claude Code invocation via `query()` | Already in project; executor uses it |
| `zod` | `^4.3.6` | Config schema validation | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` | `^10.3.0` | Structured logging | Already in project |
| `p-queue` | `^9.1.0` | Job queue concurrency | Already in project |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single handler for all surfaces | Separate handler per surface | Separate handlers would duplicate 90% of logic (clone, execute, track); unified handler with payload normalization is cleaner |
| Claude updates tracking comment via MCP tool | Handler updates tracking comment after execution | MCP approach lets Claude write its response directly, avoiding the handler needing to extract text from execution result |
| Listing all comments via REST API | GraphQL for comment history | REST `issues.listComments` is simpler and sufficient; GraphQL would be needed only if fetching deeply nested review threads |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  handlers/
    mention.ts            # createMentionHandler() - registers events, normalizes payloads, orchestrates mention flow
  execution/
    mention-prompt.ts     # buildMentionPrompt() - mention-specific prompt with conversation context
    mcp/
      comment-server.ts   # Extended: add create_comment tool alongside existing update_comment
```

### Pattern 1: Unified Mention Event Normalization
**What:** Each webhook surface has a different payload shape. Normalize all three into a common `MentionEvent` structure before processing.
**When to use:** Entry point of the mention handler, immediately after receiving any mention-triggering event.
**Example:**
```typescript
// Normalized shape that all surfaces map to
interface MentionEvent {
  surface: "issue_comment" | "pr_comment" | "pr_review_comment" | "pr_review_body";
  owner: string;
  repo: string;
  issueNumber: number;       // Issue or PR number (used for issue_comment API calls)
  prNumber: number | undefined; // Set only for PR surfaces
  commentId: number;          // The comment that triggered the mention
  commentBody: string;        // The comment text containing @kodiai
  commentAuthor: string;      // Who wrote the trigger comment
  commentCreatedAt: string;   // ISO timestamp for TOCTOU filtering (Phase 6)
  replyToCommentId: number | undefined; // For review comment replies
  headRef: string | undefined; // PR head branch ref (for clone)
  baseRef: string | undefined; // PR base branch ref (for diff)
  headRepoOwner: string | undefined; // Fork clone target
  headRepoName: string | undefined;  // Fork clone target
}

function normalizeIssueComment(
  payload: IssueCommentCreatedEvent,
): MentionEvent {
  const isPR = !!payload.issue.pull_request;
  return {
    surface: isPR ? "pr_comment" : "issue_comment",
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issueNumber: payload.issue.number,
    prNumber: isPR ? payload.issue.number : undefined,
    commentId: payload.comment.id,
    commentBody: payload.comment.body,
    commentAuthor: payload.comment.user.login,
    commentCreatedAt: payload.comment.created_at,
    replyToCommentId: undefined,
    // PR details fetched later if needed (issue_comment payload lacks PR head/base)
    headRef: undefined,
    baseRef: undefined,
    headRepoOwner: undefined,
    headRepoName: undefined,
  };
}
```

### Pattern 2: Tracking Comment Lifecycle
**What:** Post a "thinking" comment immediately when the mention is detected, before the job is queued. Pass the comment ID to the executor. Claude updates it via MCP tool.
**When to use:** Every mention-triggered execution.
**Example:**
```typescript
// Step 1: Post tracking comment BEFORE queuing (fast, user sees immediate feedback)
const octokit = await githubApp.getInstallationOctokit(installationId);
const { data: trackingComment } = await octokit.rest.issues.createComment({
  owner,
  repo,
  issue_number: issueNumber,
  body: "> Thinking...\n\n*Kodiai is working on your request. This comment will be updated with the response.*",
});

// Step 2: Queue the job with the tracking comment ID
await jobQueue.enqueue(installationId, async () => {
  // ... clone, build context, execute with commentId: trackingComment.id
});
```

### Pattern 3: Conversation Context Building
**What:** Fetch prior comments on the issue/PR to give Claude conversation context. For PR surfaces, also provide PR metadata (title, body, diff info).
**When to use:** Before every mention execution.
**Example:**
```typescript
async function buildConversationContext(
  octokit: Octokit,
  mention: MentionEvent,
): Promise<string> {
  const lines: string[] = [];

  // Fetch recent issue/PR comments (general comments)
  const { data: comments } = await octokit.rest.issues.listComments({
    owner: mention.owner,
    repo: mention.repo,
    issue_number: mention.issueNumber,
    per_page: 30, // Last 30 comments for context
  });

  // Build conversation thread
  lines.push("## Conversation History");
  for (const comment of comments) {
    // Skip bot tracking comments
    if (comment.body?.startsWith("> Thinking...")) continue;
    lines.push(`### @${comment.user?.login} (${comment.created_at}):`);
    lines.push(comment.body ?? "(empty)");
    lines.push("");
  }

  // For PR surfaces, add PR metadata
  if (mention.prNumber !== undefined) {
    const { data: pr } = await octokit.rest.pulls.get({
      owner: mention.owner,
      repo: mention.repo,
      pull_number: mention.prNumber,
    });
    lines.push("## Pull Request Context");
    lines.push(`Title: ${pr.title}`);
    lines.push(`Author: ${pr.user?.login}`);
    lines.push(`Branches: ${pr.head.ref} -> ${pr.base.ref}`);
    if (pr.body) {
      lines.push(`Description: ${pr.body}`);
    }
  }

  // For review comment surfaces, include the diff hunk context
  if (mention.surface === "pr_review_comment") {
    // The review comment payload includes diff_hunk
    lines.push("## Code Context (Diff Hunk)");
    lines.push("The triggering comment is on a specific code change.");
  }

  return lines.join("\n");
}
```

### Pattern 4: Handler Registration for Three Webhook Events
**What:** Register a single handler function for all three webhook event keys that can trigger mentions.
**When to use:** In `createMentionHandler()`, mirroring the review handler pattern.
**Example:**
```typescript
export function createMentionHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  workspaceManager: WorkspaceManager;
  githubApp: GitHubApp;
  executor: ReturnType<typeof createExecutor>;
  logger: Logger;
}): void {
  // Register for all three mention-triggering events
  deps.eventRouter.register("issue_comment.created", handleMention);
  deps.eventRouter.register("pull_request_review_comment.created", handleMention);
  deps.eventRouter.register("pull_request_review.submitted", handleMention);
}
```

### Pattern 5: Issue vs PR Detection in issue_comment
**What:** The `issue_comment.created` webhook fires for both issue comments and PR comments. Distinguish using the `issue.pull_request` field.
**When to use:** In the normalizer for `issue_comment.created` events.
**Example:**
```typescript
// Source: @octokit/webhooks-types schema.d.ts - Issue interface
// The issue.pull_request field exists only when the "issue" is actually a PR
const isPR = !!payload.issue.pull_request;

// For PR comments via issue_comment:
// - issue.number IS the PR number
// - issue.pull_request.html_url points to the PR
// - But the payload does NOT include head/base ref info
// - Must fetch PR details via octokit.rest.pulls.get() for clone info
```

### Pattern 6: MCP Server Extension for Mention Write Tools
**What:** The comment MCP server currently only has `update_comment`. Add `create_comment` for posting new issue/PR comments and `create_review_comment_reply` for replying in review threads.
**When to use:** Phase 5 adds write tools as noted in prior decisions [03-03].
**Example:**
```typescript
// Add to createCommentServer():
tool(
  "create_comment",
  "Create a new comment on an issue or pull request",
  {
    issueNumber: z.number().describe("Issue or PR number"),
    body: z.string().describe("Comment body (markdown)"),
  },
  async ({ issueNumber, body }) => {
    const octokit = await getOctokit();
    const { data } = await octokit.rest.issues.createComment({
      owner, repo,
      issue_number: issueNumber,
      body,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: true, comment_id: data.id }) }],
    };
  },
),
```

### Anti-Patterns to Avoid
- **Don't create separate handlers for each surface:** All four surfaces share the same execution flow (clone -> context -> execute -> track). A single handler with payload normalization avoids 90% code duplication.
- **Don't post the response in the handler after execution:** Let Claude write its response directly into the tracking comment via the `update_comment` MCP tool. This avoids the handler needing to extract text from `ExecutionResult`.
- **Don't fetch PR data redundantly:** For `issue_comment.created` on a PR, the payload lacks `head`/`base` info. Fetch PR details once via `pulls.get()` and pass the data to both the context builder and workspace manager.
- **Don't respond to mentions in edited comments:** Only trigger on `created` actions. Responding to `edited` would cause duplicate responses and confusion.
- **Don't skip the mention check:** Always verify the comment body actually contains `@kodiai` (or the app slug). The webhook fires for ALL comments on subscribed repos, not just mentions.
- **Don't post tracking comment inside the job queue:** The tracking comment must be posted BEFORE the job is queued, so the user sees immediate feedback even if the queue is busy.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mention detection | Complex regex parsing | Simple `body.includes(`@${appSlug}`)` check | The app slug is known; case-insensitive includes is sufficient |
| Conversation context from comments | Custom pagination logic | `octokit.rest.issues.listComments({ per_page: 30 })` | Octokit handles pagination; 30 comments is sufficient context |
| PR metadata for context | GraphQL multi-query | `octokit.rest.pulls.get()` for title/body/branches | Single REST call gives everything needed; GraphQL is overkill |
| Tracking comment create/update | Custom HTTP calls | `octokit.rest.issues.createComment()` + `update_comment` MCP tool | Already available in the codebase |
| Review comment thread replies | Custom review API wrapper | `octokit.rest.pulls.createReplyForReviewComment()` | One-liner Octokit call for thread replies |

**Key insight:** The existing infrastructure handles 80% of this phase. The new code is primarily: (1) payload normalization across surfaces, (2) conversation context assembly, (3) mention-specific prompt, and (4) tracking comment lifecycle.

## Common Pitfalls

### Pitfall 1: issue_comment Fires for Both Issues and PRs
**What goes wrong:** Treating all `issue_comment.created` events as issue-only, missing PR comment mentions.
**Why it happens:** GitHub treats PRs as a special type of issue. `issue_comment.created` fires for comments on both.
**How to avoid:** Check `payload.issue.pull_request` -- if it exists, the comment is on a PR. Use this to determine whether to fetch PR details and include PR context.
**Warning signs:** Mentions on PR general comments get issue-only context (no diff, no PR metadata).

### Pitfall 2: PR Data Missing from issue_comment Payload
**What goes wrong:** Trying to access `head.ref` or `base.ref` from an `issue_comment.created` payload and getting undefined.
**Why it happens:** The `issue_comment` payload contains an `Issue` object (with a `pull_request` sub-field containing only URLs), not a full `PullRequest` object. It lacks head/base branch info.
**How to avoid:** When `issue.pull_request` exists, make a separate `octokit.rest.pulls.get()` call to fetch full PR data (head ref, base ref, fork info) before cloning.
**Warning signs:** Clone fails with undefined ref, or workspace has wrong branch checked out.

### Pitfall 3: Tracking Comment Posted After Queue Delay
**What goes wrong:** User mentions @kodiai but sees nothing for minutes because the tracking comment is only posted once the job starts executing (after queue wait).
**Why it happens:** Posting the tracking comment inside the job queue function means it waits for prior jobs to complete.
**How to avoid:** Post the tracking comment BEFORE `jobQueue.enqueue()`. This is a fast API call (< 1 second) and provides immediate user feedback.
**Warning signs:** Long delay between mention and any visible response.

### Pitfall 4: Bot Responds to Its Own Comments
**What goes wrong:** Infinite loop: bot posts a tracking comment, which triggers another `issue_comment.created` event, which the bot processes as a new mention.
**Why it happens:** The bot's own comments fire webhook events. If the bot filter doesn't catch them (or if the tracking comment body accidentally contains `@kodiai`), the bot responds to itself.
**How to avoid:** The existing `botFilter` in the event router already drops events from the app's own bot account. This is defense-in-depth -- no additional code needed. But ensure the tracking comment body does NOT contain the `@kodiai` mention text.
**Warning signs:** Rapidly growing comment threads with bot talking to itself.

### Pitfall 5: Review Body is Null
**What goes wrong:** `pull_request_review.submitted` handler crashes when accessing `review.body` because it's null.
**Why it happens:** A review can be submitted with no body (e.g., just an approval click with no comment). The `body` field is `string | null`.
**How to avoid:** Always null-check `review.body` before checking for mentions. A null/empty body means no mention -- skip processing.
**Warning signs:** TypeError on null body access.

### Pitfall 6: Clone Depth Insufficient for PR Mentions
**What goes wrong:** Claude can't see enough history to answer questions about the PR changes.
**Why it happens:** Using depth=1 (default) means only the HEAD commit is available; `git diff` against the base branch fails.
**How to avoid:** For PR-surface mentions, use the same depth=50 as the review handler. For pure issue mentions, depth=1 is fine (no diff needed).
**Warning signs:** Claude reports inability to see code changes or diff.

### Pitfall 7: Rate Limiting When Fetching Comment History
**What goes wrong:** Fetching comment history for a very active issue/PR triggers rate limits.
**Why it happens:** Listing 100+ comments with per_page=100 and multiple pages can consume many API calls.
**How to avoid:** Limit to `per_page: 30` (most recent 30 comments provide sufficient context). Don't paginate. For extremely long threads, 30 recent comments is better than exhaustive history.
**Warning signs:** 403 "rate limit exceeded" errors during context building.

### Pitfall 8: Mentions in Edited Comments Cause Duplicate Responses
**What goes wrong:** User edits a comment to add `@kodiai`, triggering a response. Then edits again, triggering another response.
**Why it happens:** Registering for `issue_comment.edited` or `pull_request_review_comment.edited` in addition to `created`.
**How to avoid:** Only register for `.created` actions. Edited comment handling is complex (was it already processed?) and error-prone. Ignore edits.
**Warning signs:** Duplicate bot responses on the same comment.

## Code Examples

Verified patterns from official sources and existing codebase:

### Webhook Event Key Mapping
```typescript
// The four mention surfaces map to three webhook event keys:
// 1. Issue comment (on issue) -> issue_comment.created
// 2. PR comment (general)     -> issue_comment.created (with issue.pull_request present)
// 3. PR review comment (inline) -> pull_request_review_comment.created
// 4. PR review body           -> pull_request_review.submitted

// So we register three event keys to cover all four surfaces:
eventRouter.register("issue_comment.created", handleMention);
eventRouter.register("pull_request_review_comment.created", handleMention);
eventRouter.register("pull_request_review.submitted", handleMention);
```

### Mention Detection
```typescript
// Source: Existing codebase pattern (src/webhook/filters.ts)
function containsMention(body: string | null | undefined, appSlug: string): boolean {
  if (!body) return false;
  // Case-insensitive check for @appSlug (the GitHub App's username)
  return body.toLowerCase().includes(`@${appSlug.toLowerCase()}`);
}
```

### Tracking Comment Content
```typescript
// Initial tracking comment (posted immediately)
const TRACKING_INITIAL = [
  "> **Kodiai** is thinking...",
  "",
  "_Working on your request. This comment will be updated with the response._",
].join("\n");

// Error tracking comment (when execution fails)
function trackingError(errorMessage: string): string {
  return [
    "> **Kodiai** encountered an error",
    "",
    `_${errorMessage}_`,
    "",
    "Please try again or check the logs.",
  ].join("\n");
}
```

### Fetching PR Details from issue_comment
```typescript
// Source: GitHub REST API - https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
// When issue_comment fires on a PR, we need full PR data for clone info
async function fetchPRDetails(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
) {
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  return {
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    headRepoOwner: pr.head.repo?.owner.login,
    headRepoName: pr.head.repo?.name,
    title: pr.title,
    body: pr.body,
    author: pr.user?.login,
  };
}
```

### Listing Comments for Conversation Context
```typescript
// Source: GitHub REST API - https://docs.github.com/en/rest/issues/comments
// Issue comments (general discussion on issue/PR)
const { data: issueComments } = await octokit.rest.issues.listComments({
  owner,
  repo,
  issue_number: issueOrPrNumber,
  per_page: 30,  // Most recent 30 is sufficient context
});

// For PR review comments (inline diff comments), if needed:
const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
  owner,
  repo,
  pull_number: prNumber,
  per_page: 30,
  sort: "created",
  direction: "desc",
});
```

### Reply to Review Comment Thread
```typescript
// Source: GitHub REST API - https://docs.github.com/en/rest/pulls/comments#create-a-reply-for-a-review-comment
// When the mention is in a PR review comment, reply in the same thread
await octokit.rest.pulls.createReplyForReviewComment({
  owner,
  repo,
  pull_number: prNumber,
  comment_id: triggerCommentId,  // Must be the top-level comment ID
  body: responseText,
});
```

### ExecutionContext for Mentions
```typescript
// Reuses existing ExecutionContext type from src/execution/types.ts
const context: ExecutionContext = {
  workspace,
  installationId: event.installationId,
  owner: mention.owner,
  repo: mention.repo,
  prNumber: mention.prNumber,
  commentId: trackingComment.id,  // Tracking comment for update_comment MCP tool
  eventType: event.name + "." + (event.payload.action as string),
  triggerBody: mention.commentBody,
  prompt: mentionPrompt,  // Pre-built mention prompt with conversation context
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate bot for each comment surface | Single GitHub App handling all surfaces | GitHub Apps architecture | One app installation covers all webhook events |
| Polling for new comments | Webhook-driven with `issue_comment.created` | Always available | Real-time response, no polling overhead |
| Bot posts response as separate comment | Bot updates tracking comment in-place | Common pattern 2024+ | Cleaner thread, single comment for progress + response |
| `pulls.createReviewComment` for replies | `pulls.createReplyForReviewComment` for threads | GitHub API 2022+ | Proper thread nesting for inline review comment replies |

**Deprecated/outdated:**
- Using `position` parameter for review comments: `line` + `side` is preferred (clearer semantics)
- Polling-based mention detection: Webhook `issue_comment.created` is real-time and efficient

## Open Questions

1. **Where to Post Response for Review Comment Mentions**
   - What we know: For `pr_review_comment` mentions, the user mentions @kodiai in an inline diff comment. The response should ideally be a reply in the same thread.
   - What's unclear: Should the tracking comment be posted as a general PR comment (via `issues.createComment`) or as a reply in the review thread (via `pulls.createReplyForReviewComment`)?
   - Recommendation: Post tracking comment as a general PR comment (visible, easy to find), but also consider posting a brief "see my response below" reply in the review thread to maintain thread continuity. For v1, just post as a general PR comment -- it's simpler and always works.

2. **Where to Post Response for Review Body Mentions**
   - What we know: For `pull_request_review.submitted` with a mention in the body, the review body itself cannot be edited by the bot.
   - What's unclear: Should the response be a general PR comment, or a new review?
   - Recommendation: Post as a general PR comment (via `issues.createComment`). The tracking comment pattern works the same way.

3. **Conversation Context Depth**
   - What we know: 30 recent comments provides good context for most conversations.
   - What's unclear: Whether to include review comments (inline diff comments) in the conversation context for PR-surface mentions.
   - Recommendation: For v1, include only issue comments (general discussion) in conversation context. Review comments are specialized and would add noise. Claude has access to the codebase and can read files directly.

4. **Mention Stripping from Prompt**
   - What we know: The comment body contains `@kodiai what does this function do?`. The `@kodiai` prefix is not meaningful to Claude.
   - What's unclear: Whether to strip the mention prefix or pass the full body.
   - Recommendation: Strip the `@kodiai` prefix from the trigger body before including in the prompt. This avoids Claude seeing its own name and potentially getting confused.

5. **Issue-Only Mentions (No Clone)**
   - What we know: For pure issue mentions (not on a PR), there may be no relevant code to clone.
   - What's unclear: Should the handler still clone the repo for issue mentions?
   - Recommendation: Yes, always clone. The repo provides context (README, code structure) that helps Claude answer questions. Use depth=1 for issue mentions since no diff is needed. The default branch is cloned.

## Sources

### Primary (HIGH confidence)
- `@octokit/webhooks-types` `schema.d.ts` (verified in `node_modules`) -- `IssueCommentCreatedEvent`, `PullRequestReviewCommentCreatedEvent`, `PullRequestReviewSubmittedEvent`, `Issue.pull_request` field for PR detection
- [GitHub REST API - Issue Comments](https://docs.github.com/en/rest/issues/comments) -- Create, update, list issue comments endpoints
- [GitHub REST API - Pull Request Review Comments](https://docs.github.com/en/rest/pulls/comments) -- Reply to review comment, list review comments endpoints
- [GitHub Webhook Events and Payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads) -- Event names, actions, payload shapes
- [GitHub Working with Comments Guide](https://docs.github.com/en/rest/guides/working-with-comments) -- Three types of PR comments (issue, review, commit)
- Existing codebase: `src/handlers/review.ts` -- Handler factory pattern, job queue enqueue, workspace lifecycle
- Existing codebase: `src/execution/mcp/comment-server.ts` -- `update_comment` MCP tool pattern for extension
- Existing codebase: `src/execution/executor.ts` -- ExecutionContext shape, commentId field usage
- Existing codebase: `src/webhook/router.ts` -- Event registration pattern
- Existing codebase: `src/webhook/filters.ts` -- Bot filter already prevents self-reply loops

### Secondary (MEDIUM confidence)
- [GitHub REST API - Pull Request Reviews](https://docs.github.com/en/rest/pulls/reviews) -- Review submission, review body structure
- [GitHub Webhook Events Guide](https://www.magicbell.com/blog/github-webhooks-guide) -- Event relationship overview

### Tertiary (LOW confidence)
- Review comment reply thread behavior -- `in_reply_to_id` must be a top-level comment ID (replies to replies not supported); verified via API docs but not tested

## Metadata

**Confidence breakdown:**
- Webhook event mapping: HIGH -- Verified from @octokit/webhooks-types schema.d.ts in node_modules
- Comment API endpoints: HIGH -- Verified from official GitHub REST API documentation
- Handler architecture: HIGH -- Directly follows established pattern from Phase 4 review handler
- Tracking comment pattern: HIGH -- Standard GitHub bot pattern, uses existing MCP tool
- Conversation context building: MEDIUM -- API calls verified but context depth/format is a design decision
- Review comment reply threading: MEDIUM -- API endpoint verified but thread nesting behavior unverified in practice

**Research date:** 2026-02-08
**Valid until:** 2026-03-08 (GitHub API is stable; webhook events are well-established)
