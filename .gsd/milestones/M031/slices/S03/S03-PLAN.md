# S03: Outgoing Secret Scan on All Publish Paths

**Goal:** Add scanOutgoingForSecrets() to src/lib/sanitizer.ts and wire it into every agent-controlled publish path (MCP comment servers and Slack assistant handler) so credential patterns in agent-generated output are blocked before they leave the system.
**Demo:** After this: Unit test demonstrates a string containing 'ghp_abc123...' is blocked with { blocked: true, matchedPattern: 'github-pat' }. bun test src/lib/sanitizer.test.ts exits 0.

## Tasks
- [x] **T01: Added SecretScanResult interface and scanOutgoingForSecrets() with 6 named credential patterns to sanitizer.ts; all 68 tests pass** — Add the SecretScanResult interface and scanOutgoingForSecrets() function to src/lib/sanitizer.ts. Add a describe("scanOutgoingForSecrets") block to src/lib/sanitizer.test.ts.

Steps:
1. In src/lib/sanitizer.ts, after sanitizeOutgoingMentions, add:
   - Export interface SecretScanResult { blocked: boolean; matchedPattern: string | undefined; }
   - Export function scanOutgoingForSecrets(text: string): SecretScanResult that iterates 6 named regex patterns and returns { blocked: true, matchedPattern: name } on first match, { blocked: false, matchedPattern: undefined } if none match.
   - Patterns: private-key (/-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP)? ?PRIVATE KEY-----/), aws-access-key (/AKIA[0-9A-Z]{16}/), github-pat (/ghp_[A-Za-z0-9]{36}/), slack-token (/xox[baprs]-[A-Za-z0-9-]{10,}/), github-token (/gh[opsu]_[A-Za-z0-9]{36,}/), github-x-access-token-url (/https:\/\/x-access-token:[^@]+@github\.com(\/|$)/).
   - Do NOT include findHighEntropyTokens — false positive risk too high for outgoing text.
2. In src/lib/sanitizer.test.ts, import scanOutgoingForSecrets. Add describe("scanOutgoingForSecrets", () => { ... }) with tests:
   - Each of the 6 named patterns: construct a matching string, assert blocked:true and matchedPattern === name.
   - github-pat: text = "ghp_" + "A".repeat(36); expect result.blocked === true; expect result.matchedPattern === "github-pat".
   - aws-access-key: text = "AKIAIOSFODNN7EXAMPLE" (20 chars); ensure test string is 4+16=20 chars matching /AKIA[0-9A-Z]{16}/.
   - private-key: text = "-----BEGIN RSA PRIVATE KEY-----".
   - slack-token: text = "xoxb-abc1234567890".
   - github-token: text = "ghu_" + "A".repeat(36).
   - github-x-access-token-url: text = "https://x-access-token:secret@github.com/".
   - Clean text (no match): assert blocked:false, matchedPattern:undefined.
   - Mixed text (secret embedded in prose): text = "Here is the key: ghp_" + "A".repeat(36) + " end"; assert blocked:true.
3. Run bun test src/lib/sanitizer.test.ts and confirm all pass.
  - Estimate: 30m
  - Files: src/lib/sanitizer.ts, src/lib/sanitizer.test.ts
  - Verify: bun test src/lib/sanitizer.test.ts
- [x] **T02: Wired scanOutgoingForSecrets() into all 5 publish paths (4 MCP servers + Slack handler); 152 tests pass, 0 fail** — Import scanOutgoingForSecrets from sanitizer.ts in each publish path and block if a credential pattern matches. Add tests for each MCP server path.

Steps:

## comment-server.ts (create_comment and update_comment)
In both tool handlers, after sanitized = sanitizeOutgoingMentions(...), add:
  const scanResult = scanOutgoingForSecrets(sanitized);
  if (scanResult.blocked) {
    logger?.warn({ matchedPattern: scanResult.matchedPattern, tool: "create_comment" }, "Outgoing secret scan blocked publish");
    return { content: [{ type: "text" as const, text: "[SECURITY: response blocked — contained credential pattern]" }], isError: true };
  }
Add to import line: import { sanitizeOutgoingMentions, scanOutgoingForSecrets } from "../../lib/sanitizer.ts";

## inline-review-server.ts (create_inline_comment)
After const sanitizedBody = sanitizeOutgoingMentions(body, botHandles);
Add the same scan block (tool name: "create_inline_comment"). The logger is already available from the outer function signature.

## review-comment-thread-server.ts (reply_to_pr_review_comment)
The body passed to octokit is built as: sanitizeOutgoingMentions(sanitizeDecisionBody(wrapInDetails(body, "kodiai response")), botHandles)
Capture this in a variable: const publishBody = sanitizeOutgoingMentions(...);
Add scan after capture, before octokit call. Note: no logger available in this server — omit logger.warn.

## issue-comment-server.ts (createCommentHandler and updateCommentHandler)
This server has no sanitizeOutgoingMentions or scanOutgoingForSecrets yet.
- Add botHandles: string[] parameter to createIssueCommentServer() signature.
- Pass botHandles down to both createCommentHandler and updateCommentHandler via their deps objects.
- In each handler, after const body = resolveBody(params): add sanitizeOutgoingMentions then scanOutgoingForSecrets. Use the sanitized body for the octokit call.
- Update createIssueCommentServer signature: add botHandles: string[] as 5th parameter.
- Update call site in src/execution/mcp/index.ts: pass deps.botHandles ?? [] as the 5th argument to createIssueCommentServer.

## assistant-handler.ts (all publishInThread calls)
- After the destructuring block that extracts publishInThread from deps, add a safePublish async function:
  async function safePublish(input: { channel: string; threadTs: string; text: string }): Promise<void> {
    const scanResult = scanOutgoingForSecrets(input.text);
    if (scanResult.blocked) {
      const localLogger = depsLogger;
      localLogger?.warn({ matchedPattern: scanResult.matchedPattern }, "Outgoing secret scan blocked Slack publish");
      await publishInThread({ ...input, text: "[Response blocked by security policy]" });
      return;
    }
    await publishInThread(input);
  }
- Replace all publishInThread({ ... }) calls in the handler body with safePublish({ ... }). Do not replace the destructured publishInThread itself or the deps.publishInThread reference.
- Add import: import { scanOutgoingForSecrets } from "../lib/sanitizer.ts";

## Tests
- In comment-server.test.ts, add test in describe("createCommentServer"): pass body containing "ghp_" + "A".repeat(36), assert result.isError === true, and result.content[0].text contains "SECURITY".
- In review-comment-thread-server.test.ts, add test: pass body containing a PAT, assert content[0].text contains "success: false" or the error path fires. Actually: the review-comment-thread-server wraps body in wrapInDetails + sanitizeDecisionBody before the scan runs, so construct a body that survives those transforms and still contains the PAT token. The simplest approach: pass body = "ghp_" + "A".repeat(36) — wrapInDetails will wrap it in <details> tags but the PAT is still present in the string, so the scan on the final body will trigger.
- In issue-comment-server.test.ts: verify the existing tests still pass with botHandles param added.
- Run bun test src/lib/sanitizer.test.ts src/execution/mcp/comment-server.test.ts src/execution/mcp/review-comment-thread-server.test.ts src/execution/mcp/issue-comment-server.test.ts
  - Estimate: 1h
  - Files: src/execution/mcp/comment-server.ts, src/execution/mcp/comment-server.test.ts, src/execution/mcp/inline-review-server.ts, src/execution/mcp/review-comment-thread-server.ts, src/execution/mcp/review-comment-thread-server.test.ts, src/execution/mcp/issue-comment-server.ts, src/execution/mcp/issue-comment-server.test.ts, src/execution/mcp/index.ts, src/slack/assistant-handler.ts
  - Verify: bun test src/lib/sanitizer.test.ts src/execution/mcp/comment-server.test.ts src/execution/mcp/review-comment-thread-server.test.ts src/execution/mcp/issue-comment-server.test.ts
