# S03: Outgoing Secret Scan on All Publish Paths — UAT

**Milestone:** M031
**Written:** 2026-03-28T17:39:11.005Z

## UAT: S03 — Outgoing Secret Scan on All Publish Paths

### Preconditions
- `bun` installed (v1.3.8+)
- `src/lib/sanitizer.ts` exports `scanOutgoingForSecrets` and `SecretScanResult`
- All 4 MCP server files and `assistant-handler.ts` have been updated

---

### Test Suite 1: scanOutgoingForSecrets() Core Function

**Run:** `bun test src/lib/sanitizer.test.ts`

#### TC-1.1: GitHub PAT blocked
- Input: `"ghp_" + "A".repeat(36)`
- Expected: `{ blocked: true, matchedPattern: "github-pat" }`

#### TC-1.2: AWS access key blocked
- Input: `"AKIAIOSFODNN7EXAMPLE"` (exactly 4+16=20 chars)
- Expected: `{ blocked: true, matchedPattern: "aws-access-key" }`

#### TC-1.3: PEM private key header blocked (RSA)
- Input: `"-----BEGIN RSA PRIVATE KEY-----"`
- Expected: `{ blocked: true, matchedPattern: "private-key" }`

#### TC-1.4: PEM private key header blocked (EC)
- Input: `"-----BEGIN EC PRIVATE KEY-----"`
- Expected: `{ blocked: true, matchedPattern: "private-key" }`

#### TC-1.5: PEM private key header blocked (OPENSSH)
- Input: `"-----BEGIN OPENSSH PRIVATE KEY-----"`
- Expected: `{ blocked: true, matchedPattern: "private-key" }`

#### TC-1.6: Slack token blocked
- Input: `"xoxb-abc1234567890"`
- Expected: `{ blocked: true, matchedPattern: "slack-token" }`

#### TC-1.7: GitHub app token blocked (ghu_ prefix)
- Input: `"ghu_" + "A".repeat(36)`
- Expected: `{ blocked: true, matchedPattern: "github-token" }`

#### TC-1.8: x-access-token URL blocked (with trailing slash)
- Input: `"https://x-access-token:secret@github.com/"`
- Expected: `{ blocked: true, matchedPattern: "github-x-access-token-url" }`

#### TC-1.9: x-access-token URL blocked (no trailing slash)
- Input: `"https://x-access-token:secret@github.com"`
- Expected: `{ blocked: true, matchedPattern: "github-x-access-token-url" }`

#### TC-1.10: Clean text passes through
- Input: `"This is a safe response with no credentials."`
- Expected: `{ blocked: false, matchedPattern: undefined }`

#### TC-1.11: Empty string passes through
- Input: `""`
- Expected: `{ blocked: false, matchedPattern: undefined }`

#### TC-1.12: Secret embedded in prose is detected
- Input: `"Here is the key: ghp_" + "A".repeat(36) + " end"`
- Expected: `{ blocked: true, matchedPattern: "github-pat" }`

**Pass criterion:** `bun test src/lib/sanitizer.test.ts` exits 0, 68 pass.

---

### Test Suite 2: MCP Server Publish Paths

**Run:** `bun test src/execution/mcp/comment-server.test.ts src/execution/mcp/review-comment-thread-server.test.ts src/execution/mcp/issue-comment-server.test.ts`

#### TC-2.1: comment-server create_comment blocks PAT
- Call `create_comment` with body containing `"ghp_" + "A".repeat(36)`
- Expected: `result.isError === true` and `result.content[0].text` contains `"SECURITY"`

#### TC-2.2: comment-server update_comment blocks PAT
- Call `update_comment` with body containing `"ghp_" + "A".repeat(36)`
- Expected: `result.isError === true` and `result.content[0].text` contains `"SECURITY"`

#### TC-2.3: review-comment-thread-server blocks PAT
- Call `reply_to_pr_review_comment` with body `"ghp_" + "A".repeat(36)`
- Body gets wrapped in `<details>` + sanitized before scan; PAT survives transforms
- Expected: `result.content[0].text` contains `"SECURITY"`

#### TC-2.4: issue-comment-server createCommentHandler blocks PAT
- Call `create_comment` via issue-comment-server with body containing PAT
- Expected: response text contains `"SECRET_SCAN_BLOCKED"` (JSON error_code convention)

#### TC-2.5: issue-comment-server updateCommentHandler blocks PAT
- Call `update_comment` via issue-comment-server with body containing PAT
- Expected: response text contains `"SECRET_SCAN_BLOCKED"`

**Pass criterion:** `bun test src/execution/mcp/comment-server.test.ts src/execution/mcp/review-comment-thread-server.test.ts src/execution/mcp/issue-comment-server.test.ts` exits 0 with all secret-scan tests passing.

---

### Test Suite 3: Full Slice Verification

**Run:** `bun test src/lib/sanitizer.test.ts src/execution/mcp/comment-server.test.ts src/execution/mcp/review-comment-thread-server.test.ts src/execution/mcp/issue-comment-server.test.ts`

**Pass criterion:** 152 pass, 0 fail.

---

### Edge Cases

#### TC-3.1: Multiple secrets — first match wins
- Input contains both a Slack token and a GitHub PAT
- Expected: `matchedPattern` is whichever pattern appears first in the patterns array (`private-key` → `aws-access-key` → `github-pat` → `slack-token` → ...)

#### TC-3.2: Scan runs on final sanitized body, not raw input
- A body with `@kodiai ghp_AAAA...` (36 As) goes through `sanitizeOutgoingMentions` first
- The `@kodiai` prefix is stripped; the PAT token remains
- Expected: scan still detects the PAT and blocks

#### TC-3.3: Slack assistant blocks but still posts safe message
- `safePublish` in `assistant-handler.ts` detects a PAT in the text
- Expected: `publishInThread` is still called with `"[Response blocked by security policy]"` — the thread is not silently dropped
