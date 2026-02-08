# Phase 7: Operational Resilience - Research

**Researched:** 2026-02-08
**Domain:** Timeout enforcement, process termination, error handling pipeline, user-facing error reporting via GitHub API
**Confidence:** HIGH

## Summary

This phase adds two capabilities to the existing kodiai codebase: (1) timeout enforcement that terminates long-running Claude Code executions and posts an error comment, and (2) a comprehensive error handling pipeline that ensures every failure mode results in a user-visible error comment on the originating PR or issue -- never silent failure.

The codebase already has partial error handling in the mention handler (it catches errors and updates the tracking comment), but the review handler catches errors and only logs them -- the user never sees anything. Neither handler has timeout enforcement. The Claude Agent SDK's `query()` function returns a `Query` object that extends `AsyncGenerator` and exposes both an `abortController` option (for timeout-based cancellation) and a `.close()` method (for forceful termination). These are the primary mechanisms for implementing timeout. p-queue's built-in `timeout` option is NOT suitable because it only rejects the promise without actually killing the underlying Claude Code subprocess -- the process would continue running and consuming resources.

The recommended approach is: (1) wrap the executor's `execute()` method with `AbortController` + `AbortSignal.timeout()` to enforce a configurable timeout that actually terminates the Claude Code subprocess, (2) add a `timeoutMs` config field to `.kodiai.yml`, (3) create a shared error formatting module that produces clear, actionable GitHub comments, and (4) refactor both handlers (review and mention) to use a unified error reporting pattern that posts or updates a comment on any failure path.

**Primary recommendation:** Use `AbortController` passed to the Agent SDK's `query()` with `AbortSignal.timeout()` for timeout enforcement. Create a shared `formatErrorComment()` utility. Ensure both review and mention handlers post user-visible error comments on ALL failure paths.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| AbortController / AbortSignal | Built-in (Web API) | Timeout and cancellation signaling | Native API, supported by Bun, Node, and the Claude Agent SDK's `abortController` option |
| @anthropic-ai/claude-agent-sdk | ^0.2.37 (already installed) | Query cancellation via `abortController` option and `.close()` method | Already used for execution. Provides the actual subprocess termination mechanism |
| @octokit/rest | ^22.0.1 (already installed) | Posting/updating error comments on GitHub issues and PRs | Already used throughout handlers for GitHub API calls |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| p-timeout | Transitive via p-queue | TimeoutError class for instanceof checks | If detecting timeout specifically from p-queue (not recommended path -- see pitfalls) |
| pino | ^10.3.0 (already installed) | Structured error logging alongside user-facing comments | Already used for all logging |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| AbortController + SDK abort | p-queue `timeout` option | p-queue timeout only rejects the promise -- does NOT kill the underlying Claude Code subprocess. The process continues consuming resources. UNSUITABLE for this use case. |
| AbortController + SDK abort | `Promise.race` with manual timer | Works but requires manual cleanup of the timer on success. AbortController is cleaner and integrates natively with the SDK. |
| Single timeout in executor | Timeout at queue level + executor level | Two-layer timeout adds complexity. A single timeout in the executor (where the subprocess lives) is sufficient and simpler. |

**Installation:**
```bash
# No new dependencies needed -- all capabilities exist in the current stack
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  lib/
    errors.ts            # Error formatting, error comment builder, error classification
  execution/
    executor.ts          # Modified: accept AbortSignal, pass to query()
    config.ts            # Modified: add timeoutMs field to RepoConfig
  handlers/
    review.ts            # Modified: error comment posting on all failure paths
    mention.ts           # Modified: unified error handling (already partial)
```

### Pattern 1: AbortController-Based Timeout in Executor
**What:** Pass an `AbortController` to the Agent SDK's `query()` function. Use `AbortSignal.timeout()` to create a timeout signal. When the timeout fires, the SDK terminates the Claude Code subprocess.
**When to use:** Every `executor.execute()` call.
**Example:**
```typescript
// Source: Claude Agent SDK sdk.d.ts (abortController option) + MDN AbortSignal.timeout()
async execute(context: ExecutionContext): Promise<ExecutionResult> {
  const startTime = Date.now();
  const timeoutMs = context.timeoutMs ?? 300_000; // 5 min default

  // Create an AbortController that fires on timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

  try {
    const sdkQuery = query({
      prompt,
      options: {
        ...otherOptions,
        abortController: controller,
      },
    });

    let resultMessage: SDKResultMessage | undefined;
    for await (const message of sdkQuery) {
      if (message.type === "result") {
        resultMessage = message as SDKResultMessage;
      }
    }

    clearTimeout(timeoutId);

    // ... build result from resultMessage
  } catch (err) {
    clearTimeout(timeoutId);

    if (controller.signal.aborted) {
      return {
        conclusion: "error",
        durationMs: Date.now() - startTime,
        errorMessage: `Job timed out after ${Math.round(timeoutMs / 1000)} seconds. The operation was taking too long and was automatically terminated.`,
        isTimeout: true,
      };
    }

    // ... handle other errors
  }
}
```

### Pattern 2: Shared Error Comment Formatting
**What:** A utility module that formats error messages into clear, actionable GitHub comments. Classifies errors into user-understandable categories (timeout, API error, configuration error, internal error) and produces markdown-formatted comment bodies.
**When to use:** Every error path in every handler.
**Example:**
```typescript
// src/lib/errors.ts

export type ErrorCategory =
  | "timeout"
  | "api_error"
  | "config_error"
  | "clone_error"
  | "internal_error";

export function classifyError(error: unknown, isTimeout: boolean): ErrorCategory {
  if (isTimeout) return "timeout";
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(".kodiai.yml")) return "config_error";
  if (message.includes("clone") || message.includes("git")) return "clone_error";
  if (message.includes("rate limit") || message.includes("API")) return "api_error";
  return "internal_error";
}

export function formatErrorComment(category: ErrorCategory, detail: string): string {
  const headers: Record<ErrorCategory, string> = {
    timeout: "Kodiai timed out",
    api_error: "Kodiai encountered an API error",
    config_error: "Kodiai found a configuration problem",
    clone_error: "Kodiai couldn't access the repository",
    internal_error: "Kodiai encountered an error",
  };

  const suggestions: Record<ErrorCategory, string> = {
    timeout: "Try breaking the task into smaller pieces, or increase the timeout in `.kodiai.yml`.",
    api_error: "This is usually temporary. Try again in a few minutes.",
    config_error: "Check your `.kodiai.yml` file for syntax or schema errors.",
    clone_error: "Verify the repository is accessible and the branch exists.",
    internal_error: "If this persists, check the server logs or open an issue.",
  };

  return [
    `> **${headers[category]}**`,
    "",
    `_${detail}_`,
    "",
    suggestions[category],
  ].join("\n");
}
```

### Pattern 3: Unified Handler Error Wrapper
**What:** A higher-order function or shared try/catch pattern that wraps handler job execution. Ensures that on ANY error, a comment is posted (or an existing tracking comment is updated) with a user-friendly error message. Ensures workspace cleanup always happens.
**When to use:** Both review and mention handlers.
**Example:**
```typescript
// Conceptual pattern -- not a literal HOF, but the error handling structure
// both handlers should follow:

await jobQueue.enqueue(installationId, async () => {
  let workspace: Workspace | undefined;
  try {
    workspace = await workspaceManager.create(installationId, cloneOptions);
    // ... handler-specific logic ...
    const result = await executor.execute(context);

    if (result.conclusion === "error") {
      await postOrUpdateErrorComment(octokit, target, result.errorMessage, result.isTimeout);
    }
  } catch (err) {
    // Catch-all: classify and post
    const category = classifyError(err, false);
    const detail = err instanceof Error ? err.message : "An unexpected error occurred";
    await postOrUpdateErrorComment(octokit, target, formatErrorComment(category, detail));
  } finally {
    await workspace?.cleanup();
  }
});
```

### Anti-Patterns to Avoid
- **p-queue timeout for process termination:** p-queue's `timeout` option uses `pTimeout` which only rejects the promise. The Claude Code subprocess keeps running. Never rely on p-queue timeout for process cleanup.
- **Catch-and-log-only in handlers:** The review handler currently catches errors and only logs them. The user sees nothing. Every catch block MUST post a comment.
- **Stack traces in error comments:** Never include raw stack traces, file paths, or internal error details in GitHub comments. Classify the error and provide actionable guidance instead.
- **Token/secret leakage in error comments:** Error messages from git clone failures may contain installation tokens in URLs. Always sanitize/redact before posting to GitHub.
- **Swallowing the cleanup error and losing the original:** If workspace cleanup fails AND the original operation also failed, log the cleanup error but propagate the original error.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timeout signaling | Manual setTimeout + flag checking | `AbortController` + `AbortSignal.timeout()` | Native API, integrates with SDK's `abortController` option, handles cleanup automatically |
| Claude Code process termination | Custom process.kill() logic | Agent SDK `abortController` option | SDK manages the subprocess lifecycle internally; external kill would leave SDK in inconsistent state |
| Comment posting/updating | Separate GitHub API calls per handler | Shared utility function `postOrUpdateErrorComment()` | DRY -- both handlers need identical logic for posting/updating error comments |
| Error message sanitization | Regex-based token stripping per-site | Existing `redactGitHubTokens()` from `src/lib/sanitizer.ts` | Already battle-tested, covers all GitHub token patterns (ghp_, gho_, ghs_, ghr_, github_pat_) |

**Key insight:** The critical "don't hand-roll" item here is subprocess termination. The Agent SDK manages the Claude Code process internally. Using `AbortController` passed through the SDK's options is the ONLY correct way to terminate it. Attempting to kill the process externally (e.g., finding the PID and sending SIGKILL) would leave the SDK in an inconsistent state, leak resources, and potentially corrupt the async generator iteration.

## Common Pitfalls

### Pitfall 1: p-queue Timeout Does Not Kill Subprocesses
**What goes wrong:** Setting `timeout` on PQueue or `queue.add()` causes the job promise to reject with `TimeoutError`, but the Claude Code subprocess continues running. The server now has an orphaned subprocess consuming CPU, memory, and API credits.
**Why it happens:** p-queue's timeout is implemented via `pTimeout`, which races the task promise against a timer. When the timer wins, it rejects the promise but has no mechanism to cancel the underlying work. The task function continues executing.
**How to avoid:** Do NOT use p-queue's timeout for process termination. Instead, use `AbortController` passed to the Agent SDK's `query()` options. The SDK listens to the abort signal and terminates the subprocess.
**Warning signs:** After a "timeout" in logs, you see the Claude Code process still consuming resources, or the workspace directory stays locked.

### Pitfall 2: Silent Failure in Review Handler
**What goes wrong:** The review handler has a catch block at line 237-239 of `src/handlers/review.ts` that logs the error but does NOT post any comment to the PR. The user opens a PR, expects a review, and nothing happens.
**Why it happens:** The review handler was built before the tracking comment pattern (Phase 5) and error reporting pattern (this phase). It only logs errors.
**How to avoid:** Add error comment posting to the review handler's catch block. Since the review handler does not currently post a tracking comment, it should post a NEW error comment when something goes wrong.
**Warning signs:** PRs that should get reviews showing no bot activity at all.

### Pitfall 3: Error Messages Leaking Internal Details
**What goes wrong:** Raw error messages like "ENOMEM: not enough memory" or "Error: connect ECONNREFUSED 127.0.0.1:8080" are posted as GitHub comments. Users see confusing technical details that they cannot act on.
**Why it happens:** Passing `err.message` directly to the GitHub comment body without classification or sanitization.
**How to avoid:** Always classify errors into user-understandable categories and use pre-written, actionable error messages. Include the specific detail as italicized context, but the primary message should be a human-readable explanation.
**Warning signs:** GitHub comments containing Node.js error codes, stack traces, or internal paths.

### Pitfall 4: Token Leakage in Error Comments
**What goes wrong:** A git clone failure includes the authenticated URL (`https://x-access-token:ghs_xxxx@github.com/...`) in the error message. This error message gets posted as a GitHub comment, exposing the installation token to anyone who can see the PR/issue.
**Why it happens:** Git errors naturally include the remote URL. If the error message is passed through to the GitHub comment without redaction, the token is exposed.
**How to avoid:** Run ALL error messages through `redactGitHubTokens()` from `src/lib/sanitizer.ts` before posting them as GitHub comments. The workspace manager already redacts tokens in thrown errors (line 138-142 of `workspace.ts`), but defense-in-depth requires redaction at the comment-posting layer too.
**Warning signs:** GitHub comments containing strings that look like `ghs_...` or `x-access-token:...`.

### Pitfall 5: AbortController Cleanup on Success Path
**What goes wrong:** If a `setTimeout` is used to trigger `controller.abort()`, but the operation succeeds before the timeout, the timer continues running. When it fires, it aborts the controller after the operation is complete, which is harmless but wastes a timer resource and may cause confusing log messages.
**Why it happens:** Not calling `clearTimeout()` on the success path.
**How to avoid:** Always `clearTimeout()` in a `finally` block or immediately after the operation completes. Alternatively, use `AbortSignal.timeout()` which manages its own lifecycle, but note that `AbortSignal.timeout()` cannot be cancelled early -- it always fires. Using manual `setTimeout` + `clearTimeout` is more resource-efficient.
**Warning signs:** Log messages about aborted operations after successful completions.

### Pitfall 6: Error Comment Posting Itself Failing
**What goes wrong:** The error handler tries to post a comment to GitHub, but the GitHub API call itself fails (rate limit, network issue, revoked token). The error handling code throws, and now the error is truly silent.
**Why it happens:** Error posting is not wrapped in its own try/catch.
**How to avoid:** Always wrap error comment posting in a separate try/catch that only logs the failure. Never let a failed error report mask the original error.
**Warning signs:** Server logs showing two consecutive errors: the original error followed by "Failed to post error comment."

### Pitfall 7: Review Handler Has No Tracking Comment ID
**What goes wrong:** The review handler does not create a tracking comment (unlike the mention handler). When it needs to report an error, it must create a NEW comment rather than update an existing one. If the error reporting code assumes a tracking comment exists, it will crash.
**Why it happens:** The review handler was designed for a different UX flow (Claude posts reviews directly, no tracking needed for the happy path).
**How to avoid:** The error reporting utility should handle both cases: "update existing comment if trackingCommentId is provided" and "create new comment if no trackingCommentId exists." Both handlers should provide a target (owner, repo, issue/PR number) and optionally a trackingCommentId.
**Warning signs:** TypeError: Cannot read property 'id' of undefined in the error reporting path.

## Code Examples

Verified patterns from official sources and the existing codebase:

### AbortController with Claude Agent SDK
```typescript
// Source: Claude Agent SDK sdk.d.ts lines 451-454
// The Options type includes:
//   abortController?: AbortController;
//   "Controller for cancelling the query. When aborted, the query will stop
//    and clean up resources."

const controller = new AbortController();
const sdkQuery = query({
  prompt: "...",
  options: {
    abortController: controller,
    // ... other options
  },
});

// To cancel:
controller.abort();
// The SDK will terminate the subprocess and clean up.
```

### AbortSignal.timeout() (Built-in Web API)
```typescript
// Source: MDN Web Docs (AbortSignal.timeout())
// Creates a signal that automatically aborts after the specified duration.
// Note: Cannot be cancelled early. Use manual setTimeout + clearTimeout if
// early cancellation is needed.

const signal = AbortSignal.timeout(300_000); // 5 minutes
// Use with fetch, SDK, etc.
```

### Manual Timeout with Cleanup
```typescript
// Source: Standard pattern
const controller = new AbortController();
const timeoutId = setTimeout(() => {
  controller.abort(new Error("timeout"));
}, timeoutMs);

try {
  // Use controller.signal or pass controller to SDK
  await doWork(controller);
} finally {
  clearTimeout(timeoutId); // Prevent timer from firing after success
}
```

### Existing Error Pattern in Mention Handler (to replicate)
```typescript
// Source: src/handlers/mention.ts lines 219-231, 232-251
// The mention handler already updates the tracking comment on error:
if (result.conclusion === "error" && trackingCommentId) {
  try {
    const errOctokit = await githubApp.getInstallationOctokit(event.installationId);
    await errOctokit.rest.issues.updateComment({
      owner: mention.owner,
      repo: mention.repo,
      comment_id: trackingCommentId,
      body: trackingError(result.errorMessage ?? "An unexpected error occurred"),
    });
  } catch (updateErr) {
    logger.error({ err: updateErr }, "Failed to update tracking comment with error");
  }
}
```

### SDK Result Error Subtypes
```typescript
// Source: Claude Agent SDK sdk.d.ts lines 1401-1416
// SDKResultError has subtypes that distinguish different failure modes:
type SDKResultError = {
  type: 'result';
  subtype: 'error_during_execution'
    | 'error_max_turns'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries';
  // ... cost, duration, errors array, etc.
};
// These subtypes can be used to provide more specific error messages to users.
```

### Posting a New Comment (for review handler errors)
```typescript
// Source: @octokit/rest (already used in mention handler)
const octokit = await githubApp.getInstallationOctokit(installationId);
await octokit.rest.issues.createComment({
  owner,
  repo,
  issue_number: prNumber, // PRs are issues in GitHub API
  body: formatErrorComment("timeout", "The review timed out after 5 minutes."),
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No timeout (hope for the best) | AbortController-based timeout with SDK integration | Agent SDK supports `abortController` | Prevents runaway jobs from consuming resources indefinitely |
| Error messages as raw strings | Classified errors with actionable suggestions | Best practice for GitHub Apps | Users can understand and act on errors instead of being confused |
| Catch-and-log-only | Catch-and-report-to-user | Phase 7 introduction | No more silent failures |
| p-queue timeout (promise rejection only) | AbortController (actual process termination) | Understanding of p-queue internals | Avoids orphaned subprocesses |

**Deprecated/outdated:**
- Using `process.kill()` directly on Claude Code subprocess: The Agent SDK manages the process lifecycle. Direct process manipulation is not supported and will leave the SDK in an inconsistent state.

## Open Questions

1. **Default timeout value**
   - What we know: Claude Code execution time varies widely. Simple reviews may take 30-60 seconds. Complex mention tasks with many tool calls may take 5+ minutes. The Agent SDK's `maxTurns` already provides an indirect limit (default: 25).
   - What's unclear: What is a reasonable default timeout that balances "let complex tasks finish" vs "don't burn credits on stuck jobs"?
   - Recommendation: Default to 300 seconds (5 minutes). This is generous enough for complex reviews but catches truly stuck processes. Make it configurable per-repo in `.kodiai.yml` as `timeoutSeconds`. The `maxTurns` config already provides an indirect cap.

2. **Should the review handler get a tracking comment?**
   - What we know: The mention handler posts a "thinking..." tracking comment immediately. The review handler does not. For error reporting, the review handler needs to create a NEW comment (not update an existing one).
   - What's unclear: Should we add a tracking comment to the review handler for consistency, or only post on error?
   - Recommendation: Keep the review handler without a tracking comment for the happy path (the review itself is the output). Only post a comment when an error occurs. This avoids noise on successful reviews. The error comment should be a new issue comment, not a review comment.

3. **Interaction between timeout and maxTurns**
   - What we know: `maxTurns` limits the number of API round-trips. `timeoutSeconds` limits wall-clock time. Both can independently stop execution.
   - What's unclear: Should they be mutually exclusive? Should hitting maxTurns be treated as an "error" with a comment?
   - Recommendation: They are complementary. maxTurns is a credit/scope guard. Timeout is a wall-clock guard. Hitting maxTurns produces a `SDKResultError` with subtype `error_max_turns` -- this should be treated as a non-error (the SDK did its best) and logged but NOT posted as an error comment. Only actual failures (crashes, API errors) and timeouts should produce error comments.

## Sources

### Primary (HIGH confidence)
- Claude Agent SDK `sdk.d.ts` -- verified `abortController` option on `Options` type (line 451-454), `Query.close()` method (line 1077), `SDKResultError` subtypes (line 1403)
- p-queue `dist/index.js` source code -- verified timeout implementation uses `pTimeout` (promise race), does NOT cancel underlying task (line 378-382)
- p-queue `dist/options.d.ts` -- verified `timeout`, `signal` (AbortSignal) options on `QueueAddOptions`
- Existing codebase `src/handlers/mention.ts` -- verified tracking comment pattern and error update pattern (lines 25-38, 219-251)
- Existing codebase `src/handlers/review.ts` -- verified NO error comment posting, catch-and-log-only (lines 237-239)
- Existing codebase `src/execution/executor.ts` -- verified executor catch-all returns `conclusion: "error"` (lines 123-137)
- Existing codebase `src/lib/sanitizer.ts` -- verified `redactGitHubTokens()` function (lines 117-139)

### Secondary (MEDIUM confidence)
- [MDN AbortSignal.timeout()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static) -- static method for creating auto-aborting signals
- [MDN AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) -- AbortSignal API reference
- [p-queue README](https://github.com/sindresorhus/p-queue) -- timeout and signal options documentation

### Tertiary (LOW confidence)
- None -- all findings verified through primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all needed capabilities exist in the current dependency set (Agent SDK abortController, Octokit comment API, built-in AbortController)
- Architecture: HIGH -- patterns are straightforward (timeout wrapper, error formatter, comment poster) and the codebase already has partial implementations to build on
- Pitfalls: HIGH -- verified through source code analysis (p-queue timeout behavior, review handler silent failure, token leakage vectors)

**Research date:** 2026-02-08
**Valid until:** 2026-03-10 (30 days -- all technologies are stable)
