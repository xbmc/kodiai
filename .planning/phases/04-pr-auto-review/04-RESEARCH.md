# Phase 4: PR Auto-Review - Research

**Researched:** 2026-02-07
**Domain:** GitHub PR review API, webhook event handling, review prompt engineering, fork PR support
**Confidence:** HIGH

## Summary

Phase 4 wires the execution engine (Phase 3) to actual PR review workflows. The core work is: (1) a review handler that receives `pull_request.opened` and `pull_request.ready_for_review` events, extracts PR metadata from the webhook payload, clones the repo, fetches diff/file data, builds a review-specific prompt, and invokes the executor; (2) a review-specific prompt that instructs Claude to use inline comments with suggestion blocks for issues and to silently approve clean PRs; (3) integration with the GitHub PR Reviews API to batch-submit review comments atomically.

The existing codebase provides all the infrastructure needed: event router with `register()` for specific event keys, job queue for per-installation concurrency, workspace manager for cloning, executor with MCP server integration, and inline review comment MCP server. What's missing is the handler that ties these together, a richer prompt builder, data fetching from GitHub (diff, PR metadata), content sanitization, and the review submission logic.

A critical architectural choice for this phase is **how review comments are posted**. The current MCP server (`createInlineReviewServer`) posts individual review comments via `octokit.rest.pulls.createReviewComment()`. This creates standalone comments, not grouped into a review. For Phase 4, the better approach is to use `octokit.rest.pulls.createReview()` with a `comments` array and an `event` field ("APPROVE" or "COMMENT") to atomically submit all review feedback as a single review. This avoids notification spam (one notification per comment) and enables silent approval. However, this requires Claude to collect all findings first and batch-submit them, rather than posting comments one at a time. The simplest approach: keep the existing MCP tool for inline comments (Claude posts as it finds issues), then after Claude finishes, submit a formal review with event "APPROVE" if no comments were posted, or "COMMENT" if comments exist. This hybrid approach lets Claude post comments progressively while still achieving clean approvals.

**Primary recommendation:** Build a review handler that registers for `pull_request.opened` and `pull_request.ready_for_review`, fetches PR data via GraphQL and REST diff, builds a review-specific prompt using the xbmc workflow pattern as a template, runs the executor, and uses post-execution logic to submit a silent approval if no inline comments were created.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@octokit/rest` | `^22.0.1` | GitHub REST API (reviews, comments, PR data) | Already in project; provides `pulls.createReview()` for batch review submission |
| `@octokit/webhooks-types` | `^7.6.1` | TypeScript types for webhook payloads | Already in devDependencies; provides `PullRequestOpenedEvent`, `PullRequestReadyForReviewEvent` types |
| `@anthropic-ai/claude-agent-sdk` | `^0.2.37` | Claude Code invocation via `query()` | Already in project; executor uses it |
| `zod` | `^4.3.6` | Config schema validation | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `js-yaml` | `^4.1.1` | Parse `.kodiai.yml` | Already in project; config loading |
| `pino` | `^10.3.0` | Structured logging | Already in project |
| `p-queue` | `^9.1.0` | Job queue | Already in project |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Individual `createReviewComment` calls | Batch `createReview` with comments array | Batch is cleaner (atomic, one notification) but requires collecting all comments upfront; hybrid approach recommended |
| GraphQL for PR diff | REST `pulls.get()` + `pulls.listFiles()` | GraphQL gets everything in one query but diff patches are not available via GraphQL (files list only); REST is simpler for diff |
| Fetching diff via API | Reading diff from cloned repo with `git diff` | Cloned repo already has the code; `git diff origin/base...HEAD` gives the same diff Claude needs to review |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  handlers/
    review.ts             # createReviewHandler() - registers events, orchestrates review flow
  execution/
    prompt.ts             # Enhanced buildPrompt() with review-specific prompt generation
    review-prompt.ts      # buildReviewPrompt() - review-specific prompt builder
  lib/
    sanitizer.ts          # sanitizeContent() - port from reference implementation
    github-data.ts        # fetchPRData() - fetch PR metadata via GraphQL
    github-queries.ts     # GraphQL query strings (PR_QUERY)
    github-types.ts       # TypeScript types for GraphQL responses
```

### Pattern 1: Review Handler Registration
**What:** The review handler registers for specific webhook event keys and orchestrates the full review pipeline.
**When to use:** Entry point for all PR review automation.
**Example:**
```typescript
// Pattern derived from existing codebase (src/webhook/router.ts, src/index.ts)
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue } from "../jobs/types.ts";
import type { WorkspaceManager } from "../jobs/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { Logger } from "pino";

export function createReviewHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  workspaceManager: WorkspaceManager;
  githubApp: GitHubApp;
  executor: ReturnType<typeof createExecutor>;
  logger: Logger;
}) {
  const { eventRouter, jobQueue, workspaceManager, githubApp, executor, logger } = deps;

  const handleReview = async (event: WebhookEvent): Promise<void> => {
    const payload = event.payload as PullRequestOpenedEvent | PullRequestReadyForReviewEvent;
    const pr = payload.pull_request;

    // Skip draft PRs (opened event can fire for drafts)
    if (pr.draft) {
      logger.debug({ prNumber: pr.number }, "Skipping draft PR");
      return;
    }

    // Extract clone target: fork PRs use head.repo, same-repo PRs use repository
    const headRepo = pr.head.repo ?? payload.repository;
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const cloneOwner = headRepo.owner.login;
    const cloneRepo = headRepo.name;
    const ref = pr.head.ref;

    await jobQueue.enqueue(event.installationId, async () => {
      const workspace = await workspaceManager.create(event.installationId, {
        owner: cloneOwner,
        repo: cloneRepo,
        ref,
        depth: 50,  // Need enough depth for diff context
      });

      try {
        const result = await executor.execute({
          workspace,
          installationId: event.installationId,
          owner,
          repo,
          prNumber: pr.number,
          commentId: undefined,  // No tracking comment for reviews
          eventType: `pull_request.${payload.action}`,
          triggerBody: pr.body ?? "",
        });

        // Post-execution: silent approval if no comments were posted
        if (result.conclusion === "success") {
          await maybeApprove(event.installationId, owner, repo, pr.number);
        }
      } finally {
        await workspace.cleanup();
      }
    });
  };

  // Register for both event types
  eventRouter.register("pull_request.opened", handleReview);
  eventRouter.register("pull_request.ready_for_review", handleReview);
}
```

### Pattern 2: Fork PR Clone Strategy
**What:** For fork PRs, clone the fork repo (head.repo) but use the base repo (repository) for API calls (posting comments, submitting reviews).
**When to use:** Every PR review -- the pattern works identically for same-repo and fork PRs.
**Example:**
```typescript
// Source: webhook payload structure (PullRequest type from @octokit/webhooks-types)
// pr.head.repo is null for deleted fork repos, but non-null for active forks
// pr.head.repo.full_name gives "forker/repo" for fork PRs
// payload.repository gives the base repo where the PR targets

const pr = payload.pull_request;

// Clone target: where the code lives
const cloneTarget = {
  owner: pr.head.repo?.owner.login ?? payload.repository.owner.login,
  repo: pr.head.repo?.name ?? payload.repository.name,
  ref: pr.head.ref,
};

// API target: where comments/reviews are posted (always base repo)
const apiTarget = {
  owner: payload.repository.owner.login,
  repo: payload.repository.name,
  prNumber: pr.number,
};
```

### Pattern 3: Review Prompt Construction
**What:** Build a review-specific prompt that instructs Claude to focus only on issues, use inline comments with suggestion blocks, and approve silently if clean.
**When to use:** For all auto-review executions (not for mention handling).
**Example:**
```typescript
// Derived from: tmp/xbmc/.github/workflows/claude-code-review.yml
export function buildReviewPrompt(context: {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  prAuthor: string;
  baseBranch: string;
  headBranch: string;
  changedFiles: string[];
  customInstructions?: string;
}): string {
  return `You are reviewing pull request #${context.prNumber} in ${context.owner}/${context.repo}.

PR Title: ${context.prTitle}
PR Author: ${context.prAuthor}
PR Branch: ${context.headBranch} -> ${context.baseBranch}

${context.prBody ? `PR Description:\n${context.prBody}\n` : ""}

Changed files:
${context.changedFiles.map(f => `- ${f}`).join("\n")}

Review this pull request for issues. Be extremely concise.

Check for:
- Bugs, crashes, undefined behavior
- Memory leaks, resource management issues
- Thread safety problems
- Security vulnerabilities
- Performance issues
- Logic errors

For each issue found:
1. Use mcp__github_inline_comment__create_inline_comment to post an inline comment on the specific file and line
2. Include a GitHub suggestion block when you have a concrete fix:
   \`\`\`suggestion
   [corrected code here]
   \`\`\`
3. Keep comments brief but clear

Rules:
- NO positive feedback, NO "looks good", NO summary sections
- ONLY report actionable issues that need to be fixed
- Use inline comments for ALL code-specific issues
- When listing items, use (1), (2), (3) format -- NEVER use #1, #2, #3 to avoid GitHub treating them as issue links
- To see the full diff: use Bash(git diff origin/${context.baseBranch}...HEAD)
- To see changed files: use Bash(git log origin/${context.baseBranch}..HEAD --stat)

After your review:
1. If you found issues: post inline comments using the MCP tool. Do NOT post a summary comment.
2. If NO issues found: do nothing. Do NOT post any comment or approval -- the system handles silent approval automatically.
${context.customInstructions ? `\nCustom instructions:\n${context.customInstructions}` : ""}`;
}
```

### Pattern 4: Silent Approval via Post-Execution Check
**What:** After Claude finishes reviewing, check if any inline comments were posted. If none, submit a silent approval. If comments exist, do nothing (comments already posted individually).
**When to use:** After every review execution completes successfully.
**Example:**
```typescript
// Source: GitHub REST API - https://docs.github.com/en/rest/pulls/reviews
async function maybeApprove(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<void> {
  const octokit = await githubApp.getInstallationOctokit(installationId);

  // Check if our bot posted any review comments on this PR
  const { data: comments } = await octokit.rest.pulls.listReviewComments({
    owner, repo, pull_number: prNumber,
    sort: "created", direction: "desc", per_page: 10,
  });

  const appSlug = githubApp.getAppSlug();
  const botComments = comments.filter(c =>
    c.user?.login === `${appSlug}[bot]`
  );

  if (botComments.length === 0) {
    // No issues found -- submit silent approval
    await octokit.rest.pulls.createReview({
      owner, repo, pull_number: prNumber,
      event: "APPROVE",
      // No body = silent approval
    });
    logger.info({ prNumber }, "Clean PR - silent approval submitted");
  } else {
    logger.info({ prNumber, commentCount: botComments.length }, "Issues found - skipping approval");
  }
}
```

### Pattern 5: Content Sanitization
**What:** Sanitize user-provided content (PR body, comments) before including in the prompt to prevent injection attacks.
**When to use:** Before any user content is included in the Claude prompt.
**Example:**
```typescript
// Port from: tmp/claude-code-action/src/github/utils/sanitizer.ts
export function sanitizeContent(content: string): string {
  content = stripHtmlComments(content);        // <!-- hidden instructions -->
  content = stripInvisibleCharacters(content); // Zero-width chars, control chars
  content = stripMarkdownImageAltText(content); // Injections in alt text
  content = stripMarkdownLinkTitles(content);   // Injections in link titles
  content = stripHiddenAttributes(content);     // data-*, aria-label, title attrs
  content = normalizeHtmlEntities(content);     // &#xx; entities
  content = redactGitHubTokens(content);        // ghp_, gho_, ghs_, ghr_, github_pat_
  return content;
}
```

### Anti-Patterns to Avoid
- **Don't post a summary comment AND inline comments:** The xbmc workflow posts a collapsed summary comment -- kodiai should NOT do this. Inline comments are sufficient. Summary comments add noise, especially for clean PRs.
- **Don't let Claude submit the approval:** Claude should NOT call `gh pr review --approve` because the bot should only approve based on post-execution logic (checking if any issues were found). This prevents Claude from prematurely approving.
- **Don't skip draft PR filtering:** The `pull_request.opened` event fires for draft PRs too. Always check `pr.draft` and skip drafts.
- **Don't use shallow clone depth=1 for reviews:** Diffs need context. Use `depth=50` minimum so `git diff origin/base...HEAD` has enough history.
- **Don't clone the base repo for fork PRs:** Clone the fork repo (head.repo) to get the actual code being reviewed. Use the base repo only for API calls (comments, reviews).
- **Don't include the approval tool in Claude's allowed tools:** If Claude has access to `gh pr review --approve`, it might approve PRs it shouldn't. The handler should control approval logic.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Content sanitization | Custom regex per attack vector | Port `sanitizer.ts` from reference implementation | Reference code handles 7 categories of injection attacks (invisible chars, HTML comments, token patterns, etc.) |
| PR diff generation | Custom diff parsing/formatting | `git diff origin/base...HEAD` in cloned workspace | Git produces the canonical diff; no need to parse GitHub's diff format |
| Review comment line mapping | Custom diff-to-line-number mapper | Let Claude read files directly and use line numbers from the source | Claude sees the actual files and can determine line numbers accurately |
| GraphQL PR data fetching | Custom REST API aggregation | Port `PR_QUERY` from reference implementation | Single GraphQL query gets title, body, author, files, comments, reviews |
| Webhook payload type safety | Manual type assertions | Import types from `@octokit/webhooks-types` | Fully typed `PullRequestOpenedEvent`, `PullRequestReadyForReviewEvent` |

**Key insight:** The reference implementation (`tmp/claude-code-action/`) has already solved the hardest problems (sanitization, GraphQL queries, data formatting). Porting is faster and more correct than rebuilding.

## Common Pitfalls

### Pitfall 1: Draft PR Triggers
**What goes wrong:** Bot reviews draft PRs, wasting credits and annoying authors.
**Why it happens:** `pull_request.opened` fires for draft PRs too. Only `ready_for_review` is draft-exclusive.
**How to avoid:** Check `payload.pull_request.draft === true` and skip the review.
**Warning signs:** Reviews appearing on draft PRs.

### Pitfall 2: Fork PR Clone Failure
**What goes wrong:** Workspace manager fails to clone fork repo because installation token is for the base repo, not the fork.
**Why it happens:** Installation tokens are scoped to the repos where the app is installed. The fork repo is a different repo.
**How to avoid:** For fork PRs from public repos, the clone URL can use HTTPS without auth (public repos are readable without tokens). For private forks, the app must also be installed on the fork org/user. Alternatively, use `git fetch` from the base repo to get the PR ref: `git fetch origin pull/NUMBER/head:pr-branch`.
**Warning signs:** 403 errors during clone for fork PRs.

### Pitfall 3: Shallow Clone Missing Diff Base
**What goes wrong:** `git diff origin/base...HEAD` fails because the base branch is not in the shallow clone.
**Why it happens:** `git clone --single-branch --branch HEAD_REF` only fetches the head branch. The base branch (`main`, etc.) is not available.
**How to avoid:** After cloning, run `git fetch origin BASE_REF --depth=1` to fetch the base branch tip. Then `git diff origin/BASE_REF...HEAD` works.
**Warning signs:** "unknown revision or path" errors from git diff.

### Pitfall 4: Comment Line Number Validation Errors
**What goes wrong:** `createReviewComment` returns 422 "Validation Failed" because the line number is not in the PR diff.
**Why it happens:** GitHub only allows inline comments on lines that are part of the diff. Claude might try to comment on a line that's in the file but not in the changed region.
**How to avoid:** The MCP tool already handles this with a helpful error message. Claude will retry with a corrected line number. The review prompt should instruct Claude to focus on changed lines.
**Warning signs:** Repeated 422 errors in MCP tool responses.

### Pitfall 5: Rate Limiting on Large PRs
**What goes wrong:** Many inline comments trigger GitHub's secondary rate limit (abuse detection).
**Why it happens:** GitHub treats rapid-fire comment creation as potential abuse. Creating >20 comments in quick succession can trigger throttling.
**How to avoid:** The MCP tool posts comments one at a time as Claude generates them, which naturally spaces them out. For very large reviews, consider batching via `createReview` with comments array. The `maxTurns` limit also naturally caps the number of comments.
**Warning signs:** 403 "secondary rate limit" errors from GitHub API.

### Pitfall 6: head.repo is Null for Deleted Fork Repos
**What goes wrong:** `pr.head.repo` is `null` if the fork has been deleted after the PR was created.
**Why it happens:** GitHub sets `head.repo` to `null` when the source repo no longer exists.
**How to avoid:** Fall back to fetching the PR ref from the base repo: `git fetch origin pull/NUMBER/head:pr-review`. Always check for `head.repo === null` before using it for clone.
**Warning signs:** TypeError when accessing `head.repo.owner`.

### Pitfall 7: Review on Wrong Commit
**What goes wrong:** Review comments reference a commit that is no longer the head of the PR.
**Why it happens:** A force push happened between when the webhook was received and when the review is posted.
**How to avoid:** When posting inline comments, use the current `head.sha` fetched from the API, not the one from the webhook payload. The existing MCP tool already does this (`pr.data.head.sha`).
**Warning signs:** GitHub shows "This comment is outdated" on review comments.

## Code Examples

Verified patterns from official sources and reference implementation:

### Webhook Payload Extraction
```typescript
// Source: @octokit/webhooks-types schema.d.ts (verified in node_modules)
import type {
  PullRequestOpenedEvent,
  PullRequestReadyForReviewEvent,
} from "@octokit/webhooks-types";

function extractPRData(payload: PullRequestOpenedEvent | PullRequestReadyForReviewEvent) {
  const pr = payload.pull_request;

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    author: pr.user.login,
    draft: pr.draft,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    // Fork detection
    isFork: pr.head.repo?.full_name !== payload.repository.full_name,
    // Clone target for forks
    cloneOwner: pr.head.repo?.owner.login ?? payload.repository.owner.login,
    cloneRepo: pr.head.repo?.name ?? payload.repository.name,
    // API target (always base repo)
    apiOwner: payload.repository.owner.login,
    apiRepo: payload.repository.name,
  };
}
```

### Silent Approval via Octokit
```typescript
// Source: GitHub REST API - https://docs.github.com/en/rest/pulls/reviews
// Verified: APPROVE event does not require body parameter
await octokit.rest.pulls.createReview({
  owner,
  repo,
  pull_number: prNumber,
  event: "APPROVE",
  // No body = truly silent approval (no comment posted)
});
```

### Fetching Base Branch for Diff Context
```typescript
// After workspace creation, fetch base branch for diff comparison
import { $ } from "bun";

async function fetchBaseBranch(workspaceDir: string, baseBranch: string): Promise<void> {
  // The workspace was cloned with --single-branch for the head branch.
  // We need the base branch tip for diff comparison.
  await $`git -C ${workspaceDir} fetch origin ${baseBranch} --depth=1`.quiet();
}
```

### GraphQL PR Data Fetch (Ported from Reference)
```typescript
// Source: tmp/claude-code-action/src/github/api/queries/github.ts
const PR_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        title
        body
        author { login }
        baseRefName
        headRefName
        headRefOid
        additions
        deletions
        state
        files(first: 100) {
          nodes {
            path
            additions
            deletions
            changeType
          }
        }
      }
    }
  }
`;
```

### Review Config Schema Extension
```typescript
// Extension to existing src/execution/config.ts
const reviewConfigSchema = z.object({
  enabled: z.boolean().default(true),
  autoApprove: z.boolean().default(false),
  prompt: z.string().optional(),  // Custom review instructions
  skipAuthors: z.array(z.string()).default([]),  // Authors to skip (e.g., dependabot)
  skipPaths: z.array(z.string()).default([]),  // Path patterns to skip review
}).default({
  enabled: true,
  autoApprove: false,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `position` parameter in review comments | `line` + `side` parameters | GitHub API 2022-11-28 | `line` is more intuitive (actual line number vs diff position) |
| `pull_request_target` for fork PR access | GitHub App with installation token | Always available for Apps | No workflow YAML needed, native fork support |
| Individual `createReviewComment` calls | `createReview` with `comments` array | Always available | Atomic review submission, single notification |
| Hard-coded review prompt in workflow YAML | `.kodiai.yml` with custom `review.prompt` | Kodiai architecture | Per-repo customization without workflow files |

**Deprecated/outdated:**
- `position` parameter in review comments: Still works but `line` is preferred (clearer semantics)
- GitHub Actions `pull_request_target` + checkout pattern for fork reviews: Replaced by GitHub App approach (no Actions minutes consumed)

## Open Questions

1. **Batch Review vs Individual Comments**
   - What we know: `createReview` batches comments atomically. Current MCP tool posts individual comments. Both approaches work.
   - What's unclear: Whether to refactor the MCP tool to collect comments and batch-submit, or keep individual posting and handle approval separately.
   - Recommendation: Keep individual comments (simpler, Claude posts as it finds issues). Add post-execution approval logic. This is the pragmatic choice for Phase 4; batch optimization can come later.

2. **PR Diff Source: API vs Git**
   - What we know: The cloned workspace has the full code. `git diff origin/base...HEAD` produces the complete diff. The GraphQL API provides file list but not diff content.
   - What's unclear: Whether to fetch the diff via REST API (`application/vnd.github.v3.diff` media type on `pulls.get`) or let Claude run `git diff` from the workspace.
   - Recommendation: Let Claude run `git diff` in the workspace. It already has `Bash(git diff:*)` in allowed tools. No need to prefetch the diff.

3. **Fork PR Clone Authentication**
   - What we know: Installation tokens are scoped to repos where the app is installed. Public fork repos can be cloned without auth. Private fork repos require the app to be installed on the fork.
   - What's unclear: Whether to support private forks (requires app installation on fork) or only public forks.
   - Recommendation: For v1, support public forks by cloning without auth when the head repo differs from the base repo. For private forks, fall back to `git fetch origin pull/NUMBER/head:pr-branch` from the base repo. Document limitation.

4. **Review Comments on Non-Diff Lines**
   - What we know: GitHub only allows inline comments on lines that appear in the diff. Claude might find issues on non-diff lines.
   - What's unclear: How to handle findings on non-diff lines (post as general PR comment? skip? post on nearest diff line?).
   - Recommendation: The MCP tool already returns a helpful error. Claude will either retry on a diff line or skip. No special handling needed.

5. **Config-Driven Review Enable/Disable**
   - What we know: The `.kodiai.yml` schema already has `review.enabled` and `review.autoApprove` fields.
   - What's unclear: Whether config should be loaded before or after cloning (loading from API vs from cloned workspace).
   - Recommendation: Load config from the cloned workspace (consistent with Phase 3 `loadRepoConfig`). The workspace already exists before execution begins. If review is disabled in config, skip execution and return early.

## Sources

### Primary (HIGH confidence)
- Reference implementation: `tmp/claude-code-action/src/github/utils/sanitizer.ts` - Complete content sanitization with 7 attack categories
- Reference implementation: `tmp/claude-code-action/src/github/api/queries/github.ts` - Working GraphQL queries for PR data
- Reference implementation: `tmp/claude-code-action/src/github/data/fetcher.ts` - TOCTOU protections, comment filtering
- Reference implementation: `tmp/claude-code-action/src/github/data/formatter.ts` - Data formatting for prompts
- Reference implementation: `tmp/xbmc/.github/workflows/claude-code-review.yml` - Proven review prompt template
- Existing codebase: `src/execution/executor.ts` - Working executor with MCP integration
- Existing codebase: `src/execution/mcp/inline-review-server.ts` - Working inline comment MCP tool
- Existing codebase: `src/webhook/router.ts` - Event registration pattern
- Existing codebase: `src/jobs/workspace.ts` - Clone and workspace management
- `@octokit/webhooks-types` `schema.d.ts` - Verified webhook payload types (PullRequest.head.repo, head.ref, draft, etc.)

### Secondary (MEDIUM confidence)
- [GitHub REST API - Pull Request Reviews](https://docs.github.com/en/rest/pulls/reviews?apiVersion=2022-11-28) - `createReview` API, APPROVE event, comments array
- [GitHub REST API - Pull Request Review Comments](https://docs.github.com/en/rest/pulls/comments) - `createReviewComment`, line vs position, multi-line comments
- [GitHub CLI - gh pr review](https://cli.github.com/manual/gh_pr_review) - `--approve` flag behavior (no body = silent)

### Tertiary (LOW confidence)
- Fork PR authentication strategy - Based on general GitHub App knowledge; exact behavior for private forks unverified
- Rate limiting thresholds for review comments - Based on community reports, not official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in the project, APIs verified from official docs
- Architecture: HIGH - Patterns directly derived from existing codebase and reference implementation
- Review prompt: HIGH - Based on proven xbmc workflow that's actively used in production
- Fork PR handling: MEDIUM - Public fork cloning is straightforward; private fork edge cases are theoretical
- Pitfalls: HIGH - Most derived from reference implementation patterns and GitHub API documentation

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (GitHub API is stable; review prompt may need tuning after testing)
