# S03 Research: Outgoing Secret Scan on All Publish Paths

**Researched:** 2026-03-28
**Complexity:** Light — straightforward additive change using existing patterns already in this codebase

---

## Summary

This slice adds `scanOutgoingForSecrets()` to `src/lib/sanitizer.ts` and applies it at every agent-controlled publish path. The patterns to reuse (`buildSecretRegexes()`) already exist in `workspace.ts` — they are battle-tested and appropriately narrow. No new technology, no third-party dependencies.

The main decisions are: (a) the exact return type of `scanOutgoingForSecrets()`, (b) where in each publish path to call it, and (c) what to do with the result (block vs redact). The architecture decision already specifies block-at-MCP-layer with `isError: true`.

---

## What Already Exists

### Secret patterns — `src/jobs/workspace.ts` (lines 231-240)

`buildSecretRegexes()` is a private function returning 6 named patterns:

```ts
{ name: "private-key",                regex: /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP)? ?PRIVATE KEY-----/ }
{ name: "aws-access-key",             regex: /AKIA[0-9A-Z]{16}/ }
{ name: "github-pat",                 regex: /ghp_[A-Za-z0-9]{36}/ }
{ name: "slack-token",                regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ }
{ name: "github-token",               regex: /gh[opsu]_[A-Za-z0-9]{36,}/ }
{ name: "github-x-access-token-url",  regex: /https:\/\/x-access-token:[^@]+@github\.com(\/|$)/ }
```

`findHighEntropyTokens()` (lines 253-280) also exists — it finds 32+ char base64-ish strings with Shannon entropy ≥ 4.5, with carve-outs for hex hashes and UUIDs.

**These are private to `workspace.ts`** — `scanOutgoingForSecrets()` will need its own copy of the patterns (or they can be exported from workspace.ts and shared). The cleanest approach: define the secret regexes as a constant exported from `sanitizer.ts` so both the workspace scan and the outgoing scan share a single source of truth. This is a small refactor — export from `sanitizer.ts`, import in `workspace.ts`.

Alternatively (simpler for S03, easier for S05 proof harness): duplicate the patterns inline in `sanitizer.ts`. The slice's roadmap proof is "a string containing `ghp_abc123...` is blocked with `{ blocked: true, matchedPattern: 'github-pat' }`" — this only requires the function to exist and be correct, not to share code with workspace.ts. Keep it self-contained in `sanitizer.ts`.

**Decision: define patterns inline in `sanitizer.ts`.** The workspace.ts patterns are private by design and serve a different context (file diff scanning). Duplication is fine here — the outgoing scan is a different enforcement boundary.

### Existing sanitizer.ts outgoing function

`sanitizeOutgoingMentions(body, handles)` is the only current outgoing sanitizer. Tests for it are in `src/lib/sanitizer.test.ts`. The `scanOutgoingForSecrets()` function goes alongside it in the same file and test.

### MCP publish paths

**comment-server.ts** (`create_comment`, `update_comment`):
- Both tools run through `sanitizeOutgoingMentions(...)` before posting
- The scan should be added immediately after `sanitizeOutgoingMentions` (or before) — same variable, check result, return `isError: true` if blocked
- Pattern already in test: `comment-server.test.ts` uses `getToolHandlers()` to exercise tools directly — same pattern for the new scan test

**inline-review-server.ts** (`create_inline_review`):
- `sanitizedBody = sanitizeOutgoingMentions(body, botHandles)` at line 136
- Add scan after this line, before the `reviews.createReview` call

**review-comment-thread-server.ts** (`reply_to_review_thread`):
- `body: sanitizeOutgoingMentions(...)` at line 60
- Same pattern — intercept after sanitizeOutgoingMentions, before the API call

**issue-comment-server.ts** (`create_issue_comment`, `update_issue_comment`):
- Currently NO sanitization at all — `body` is posted raw (line 155)
- Need both `sanitizeOutgoingMentions` AND `scanOutgoingForSecrets` here
- The file has a `resolveBody()` helper that returns the final body string — apply sanitization after `resolveBody()` call at lines 136 and 229

**Slack `publishInThread`** (injected dep in `assistant-handler.ts`):
- `publishInThread` is called with `{ channel, threadTs, text }` across many sites in `assistant-handler.ts`
- The injected dep is wired in `src/index.ts:315` to `slackClient.postThreadMessage`
- Options:
  1. Wrap `publishInThread` at injection site in `index.ts`
  2. Add a `sanitizePublishText()` wrapper in `assistant-handler.ts` and call it at each `publishInThread` site
  3. Wrap at the `slackClient.postThreadMessage` layer

  The cleanest containment: **wrap at the `assistant-handler.ts` level** — add a private `safePublish()` helper that calls `scanOutgoingForSecrets(text)` and logs+blocks if matched. `assistant-handler.ts` is where the agent output arrives; it's the right enforcement boundary. The handler already has a logger available.

  Note: Most Slack messages in `assistant-handler.ts` are static strings (status updates like "Write run started for owner/repo.") — low risk. The agent-generated output arrives in `replyText` at lines ~322, ~346, ~363, ~388, ~409, ~475, ~495, ~525, ~638. All `publishInThread` calls should go through `safePublish()` for defense-in-depth.

---

## Exact Implementation Plan

### 1. `src/lib/sanitizer.ts` — add `scanOutgoingForSecrets()`

```ts
export interface SecretScanResult {
  blocked: boolean;
  matchedPattern: string | undefined;
}

export function scanOutgoingForSecrets(text: string): SecretScanResult {
  const patterns = [
    { name: "private-key",               regex: /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP)? ?PRIVATE KEY-----/ },
    { name: "aws-access-key",            regex: /AKIA[0-9A-Z]{16}/ },
    { name: "github-pat",                regex: /ghp_[A-Za-z0-9]{36}/ },
    { name: "slack-token",               regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
    { name: "github-token",              regex: /gh[opsu]_[A-Za-z0-9]{36,}/ },
    { name: "github-x-access-token-url", regex: /https:\/\/x-access-token:[^@]+@github\.com(\/|$)/ },
  ];
  for (const { name, regex } of patterns) {
    if (regex.test(text)) {
      return { blocked: true, matchedPattern: name };
    }
  }
  return { blocked: false, matchedPattern: undefined };
}
```

**Return type:** `{ blocked: boolean; matchedPattern: string | undefined }` — callers log the pattern name without logging the matched value.

**High-entropy scan:** Do NOT include `findHighEntropyTokens` here. The entropy scan is designed for source code diffs (added lines only) where secrets are formatted as code. Outgoing comment text has a much higher density of long alphanumeric strings (base64 encoded data, commit SHAs longer than 40 chars in some contexts). False positive risk is too high for an outgoing block. The named regex patterns are sufficient.

### 2. `src/execution/mcp/comment-server.ts`

After `sanitized = sanitizeOutgoingMentions(...)`:

```ts
const scanResult = scanOutgoingForSecrets(sanitized);
if (scanResult.blocked) {
  logger.warn({ matchedPattern: scanResult.matchedPattern, tool: "create_comment" }, "Outgoing secret scan blocked publish");
  return {
    content: [{ type: "text" as const, text: "[SECURITY: response blocked — contained credential pattern]" }],
    isError: true,
  };
}
```

Same pattern for `update_comment`. The server already has a `logger` import (verify — check imports).

**Check:** Does `comment-server.ts` have a `logger`? 
- Look at the constructor signature and imports. If not, the scan result gets logged with `console.warn` or the warning is omitted. The key thing is the block, not the log. Add logger if it's passed in the constructor; omit warn if not.

### 3. `src/execution/mcp/inline-review-server.ts` and `review-comment-thread-server.ts`

Same pattern — after `sanitizeOutgoingMentions`, before API call.

### 4. `src/execution/mcp/issue-comment-server.ts`

Add both `sanitizeOutgoingMentions` and `scanOutgoingForSecrets` after `resolveBody()`. This server also needs the `botHandles` parameter added to `createIssueCommentServer()` — check current signature.

### 5. `src/slack/assistant-handler.ts`

Add a private `safePublish()` wrapper:
```ts
async function safePublish(publishInThread: PublishFn, input: PublishInput, logger: Logger): Promise<void> {
  const scanResult = scanOutgoingForSecrets(input.text);
  if (scanResult.blocked) {
    logger.warn({ matchedPattern: scanResult.matchedPattern }, "Outgoing secret scan blocked Slack publish");
    // Publish a generic message instead of blocking silently
    await publishInThread({ ...input, text: "[Response blocked by security policy]" });
    return;
  }
  await publishInThread(input);
}
```

Note: Slack blocking behavior differs from GitHub — for Slack, replacing with a generic message is better UX than returning an error (there's no tool-call error surface). The Slack handler calls `publishInThread` 10+ times; all calls should go through `safePublish()`.

---

## Files to Touch

1. **`src/lib/sanitizer.ts`** — add `scanOutgoingForSecrets()` and `SecretScanResult` interface (new export)
2. **`src/lib/sanitizer.test.ts`** — add tests for `scanOutgoingForSecrets()`: each named pattern blocks, non-secret text passes, `matchedPattern` is set correctly
3. **`src/execution/mcp/comment-server.ts`** — import `scanOutgoingForSecrets`, apply after `sanitizeOutgoingMentions` in both `create_comment` and `update_comment`
4. **`src/execution/mcp/inline-review-server.ts`** — same
5. **`src/execution/mcp/review-comment-thread-server.ts`** — same
6. **`src/execution/mcp/issue-comment-server.ts`** — add `sanitizeOutgoingMentions` + `scanOutgoingForSecrets` to both `createComment` and `updateComment` paths; check if `botHandles` parameter needs adding to server constructor
7. **`src/slack/assistant-handler.ts`** — add `safePublish()` wrapper, replace all `publishInThread(...)` calls with `safePublish(publishInThread, ..., logger)` (or refactor the handler to hold a wrapped version internally)

---

## Existing Test File Patterns

`src/lib/sanitizer.test.ts` already tests all sanitizer functions. New `scanOutgoingForSecrets` tests go in a new `describe("scanOutgoingForSecrets", ...)` block. Pattern to follow: construct a valid token string (e.g. `"ghp_" + "A".repeat(36)`), assert `scanOutgoingForSecrets(text).blocked === true` and `.matchedPattern === "github-pat"`.

`src/execution/mcp/comment-server.test.ts` uses `getToolHandlers()` to introspect `_registeredTools`. New test: pass a body containing `"ghp_" + "A".repeat(36)`, assert `result.isError === true` and result text contains `"SECURITY"`. Same pattern for other MCP servers.

---

## Verification Command

```
bun test src/lib/sanitizer.test.ts
```

The roadmap proof: "Unit test demonstrates a string containing 'ghp_abc123...' is blocked with `{ blocked: true, matchedPattern: 'github-pat' }`."

Secondary: MCP server tests should also pass with the new scan applied.

---

## Pre-Implementation Checks (for planner/executor)

1. **Does `comment-server.ts` have a logger?** Check imports and `createCommentServer()` signature. If not, omit `logger.warn` or use `console.warn`.
2. **Does `issue-comment-server.ts` accept `botHandles`?** Check `createIssueCommentServer()` signature — if `botHandles` is not a param, add it.
3. **Slack handler `safePublish` strategy**: replacing with generic message vs. throwing — the handler has no caller that inspects the return value of `publishInThread` (it's `Promise<void>`), so a warn-and-replace is correct. Do NOT silently swallow without any publish — the user would see a conversation stall.

---

## Risk Assessment

- **False positives:** Low. Named patterns are format-specific. The entropy scan is intentionally excluded.
- **Breaking change to MCP server APIs:** None — all changes are internal to the tool handlers.
- **`issue-comment-server.ts` signature change (botHandles):** May require updating call sites. Check `createIssueCommentServer()` usages before adding the param.
- **Slack handler refactor:** The `publishInThread` call sites are scattered across the handler. A wrapper function avoids the need to touch each site's call individually — preferred approach.
