---
phase: 11-mention-ux-parity
verified: 2026-02-10T02:15:25Z
status: human_needed
score: 10/13 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 9/13
  gaps_closed:
    - "The model is instructed to not post ack/tracking comments and to always reply to a mention (or ask clarifying questions)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Inline PR review comment mention replies in-thread"
    expected: "Commenting '@claude <question>' in an inline PR review comment thread adds an eyes reaction and posts the reply inside the same thread (not as a top-level PR comment)."
    why_human: "Tooling + prompt routing exist, but LLM tool choice is not enforced statically; requires real GitHub surface behavior confirmation."
  - test: "Top-level PR mention replies as a normal PR comment"
    expected: "Commenting '@kodiai <question>' as a PR top-level comment adds an eyes reaction and posts a single top-level comment reply (no extra tracking comment)."
    why_human: "End-to-end behavior depends on GitHub delivery, execution, and LLM output; cannot be proven from static code alone."
  - test: "@claude alias opt-out works on a real repo"
    expected: "With '.kodiai.yml' containing 'mention.acceptClaudeAlias: false', '@claude <question>' does not trigger a reply, while '@kodiai <question>' still does."
    why_human: "Static code shows config gating exists, but verifying in a real repo validates config load path + webhook + routing."
---

# Phase 11: Mention UX Parity Verification Report

**Phase Goal:** Mention UX parity with Claude in xbmc/xbmc: global @claude alias support, contextual mention replies, and inline PR review comment thread replies; tracking is eyes-only.
**Verified:** 2026-02-10T02:15:25Z
**Status:** human_needed
**Re-verification:** Yes — after must-have alignment to the implemented mention reply policy.
**Note:** `gsd-tools verify` still did not detect `must_haves` in plan frontmatter; verification performed by direct code inspection against the plan-stated must-haves.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | @claude is accepted as an alias for @kodiai by default | ✓ VERIFIED | `src/handlers/mention.ts` (acceptedHandles includes "claude" unless config disables) |
| 2 | A repo can opt out of @claude aliasing via .kodiai.yml | ✓ VERIFIED | `src/execution/config.ts` (mention.acceptClaudeAlias default true); `src/handlers/mention.ts` (acceptClaudeAlias = config.mention.acceptClaudeAlias !== false); `src/execution/config.test.ts` |
| 3 | Mentions that contain no question after stripping do not produce a reply | ✓ VERIFIED | `src/handlers/mention.ts` (stripMention + skip when empty) + `src/handlers/mention-types.test.ts` |
| 4 | Mention replies use surrounding conversation context filtered to trigger timestamp | ✓ VERIFIED | `src/execution/mention-context.ts` (filterCommentsToTriggerTime using commentCreatedAt); `src/lib/sanitizer.ts` (TOCTOU filter); `src/execution/mention-context.test.ts` |
| 5 | Inline PR review comment mentions include file/line/diff hunk context | ✓ VERIFIED | `src/execution/mention-context.ts` (Inline Review Comment Context section + diff hunk); `src/execution/mention-context.test.ts` |
| 6 | Eyes reaction remains the only tracking signal (no tracking comment) | ✓ VERIFIED | `src/handlers/mention.ts` (eyes reaction best-effort; explicit "No tracking comment"); `src/execution/mention-prompt.ts` (no tracking/ack comment) |
| 7 | The model is instructed to not post ack/tracking comments and to always reply to a mention (or ask clarifying questions) | ✓ VERIFIED | `src/execution/mention-prompt.ts` ("Do not post a separate tracking/ack comment" + "You MUST post a reply when you are mentioned..."); `src/handlers/mention.ts` (fallback reply when `result.published` is false) |
| 8 | Inline PR review comment mentions produce a reply in the same thread | ? UNCERTAIN | `src/execution/mention-prompt.ts` instructs `mcp__reviewCommentThread__reply_to_pr_review_comment`; `src/execution/mcp/index.ts` enables server when prNumber+commentId present; still depends on LLM tool choice |
| 9 | Non-inline mentions remain top-level issue/PR comment replies | ✓ VERIFIED | `src/execution/mention-prompt.ts` routes non-inline to `mcp__github_comment__create_comment`; `src/handlers/mention.ts` omits executor commentId for non-inline surfaces |
| 10 | The mention prompt instructs the correct tool for inline thread replies | ✓ VERIFIED | `src/execution/mention-prompt.ts` (pr_review_comment routing to thread tool + fallback instruction) |
| 11 | @claude and @kodiai mentions produce a response on a real PR when useful | ? UNCERTAIN | Requires live GitHub webhook + execution verification (see Human Verification Required) |
| 12 | Inline review-comment mentions reply in the same thread (end-to-end) | ? UNCERTAIN | Requires live GitHub surface verification (see Human Verification Required) |
| 13 | Tracking is eyes-only; no tracking comment is created | ✓ VERIFIED | `src/handlers/mention.ts` (no tracking comment creation path; eyes reaction only) |

**Score:** 10/13 truths verified

## Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/execution/config.ts` | Repo config schema includes mention.acceptClaudeAlias | ✓ VERIFIED | `mention.acceptClaudeAlias` defined with default true |
| `src/execution/config.test.ts` | Tests for defaults and opt-out | ✓ VERIFIED | Covers default true, explicit false, and strict key rejection |
| `src/handlers/mention-types.ts` | Mention parsing supports accepted handles + stripping | ✓ VERIFIED | `containsMention` + `stripMention` use boundary-safe regex (`\b`) |
| `src/handlers/mention-types.test.ts` | Unit tests for alias/boundary/strip behavior | ✓ VERIFIED | Tests partial-handle non-trigger + stripping to empty |
| `src/handlers/mention.ts` | Config-driven aliasing + skip empty + context + execution | ✓ VERIFIED | Loads repo config, gates alias, strips question, builds context, adds eyes, executes with commentId for inline |
| `src/execution/mention-context.ts` | Deterministic, bounded, sanitized context builder | ✓ VERIFIED | TOCTOU filter + sanitization + deterministic sort/limits |
| `src/execution/mention-context.test.ts` | Tests TOCTOU, sanitization, truncation, inline context | ✓ VERIFIED | Validates exclusion of newer comments + sanitization + deterministic truncation |
| `src/execution/mention-prompt.ts` | Prompt includes context + response rules + tool routing | ✓ VERIFIED | Includes eyes-only tracking instruction and inline-vs-top-level tool selection |
| `src/execution/mcp/review-comment-thread-server.ts` | MCP tool for replying to PR review comment threads | ✓ VERIFIED | Implements `reply_to_pr_review_comment` via `pulls.createReplyForReviewComment` |
| `src/execution/mcp/index.ts` | MCP registry includes thread reply tool | ✓ VERIFIED | Registers `reviewCommentThread` server when prNumber+commentId present |
| `src/execution/mcp/review-comment-thread-server.test.ts` | Asserts correct REST call | ✓ VERIFIED | Stubs Octokit and checks parameters + `<details>` wrapping |
| `docs/runbooks/mentions.md` | Operator checklist for mention flows | ✓ VERIFIED | Includes `pr_review_comment` routing and `deliveryId` correlation steps |

## Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `src/handlers/mention.ts` | `src/execution/config.ts` | loadRepoConfig controls alias behavior | ✓ WIRED | `loadRepoConfig(workspace.dir)` then `config.mention.acceptClaudeAlias !== false` |
| `src/handlers/mention.ts` | `src/execution/mention-context.ts` | Build context before prompt/executor | ✓ WIRED | `mentionContext = await buildMentionContext(octokit, mention)` |
| `src/handlers/mention.ts` | `src/execution/mcp/review-comment-thread-server.ts` | Inline surface enables thread tool | ⚠️ PARTIAL | Server is registered via `src/execution/mcp/index.ts` only when `context.commentId` is set; prompt instructs correct tool, but tool selection is not statically enforceable |
| `docs/runbooks/mentions.md` | `src/handlers/mention.ts` | Runbook maps symptoms to logs/code | ✓ WIRED | References `deliveryId` correlation and handler log messages |

## Requirements Coverage

No phase-mapped requirements were found in `.planning/REQUIREMENTS.md` for Phase 11.

## Anti-Patterns Found

- ⚠️ `docs/runbooks/mentions.md:163` claims "prompt chose to be silent" is a common reason for no reply, but `src/execution/mention-prompt.ts` + `src/handlers/mention.ts` implement an always-reply policy (prompt requires reply; handler posts fallback if nothing published).
- ⚠️ `docs/runbooks/mentions.md:181` labels `src/execution/mention-prompt.ts` as "silence allowed"; this is currently inaccurate.

## Human Verification Required

### 1) Inline PR Review Thread Reply

**Test:** In an inline PR review comment thread, post `@claude <real question>`.
**Expected:** Eyes reaction appears on the trigger; reply appears in the same inline thread.
**Why human:** Prompt/tool routing exists, but real GitHub surface + model tool choice needs validation.

### 2) Top-Level PR Comment Reply

**Test:** In a PR top-level comment, post `@kodiai <real question>`.
**Expected:** Eyes reaction appears; exactly one top-level reply comment is created; no separate tracking comment.
**Why human:** Requires real webhook/executor path.

### 3) @claude Alias Opt-Out

**Test:** In a repo with `.kodiai.yml` set to `mention.acceptClaudeAlias: false`, post `@claude <question>`.
**Expected:** No reply occurs for @claude; @kodiai still triggers.
**Why human:** Validates config loading + runtime behavior in a real repo.

## Gaps Summary

Alias support, contextual prompts, eyes-only tracking, and inline-thread reply tooling are present and wired in the codebase. The previous gap is closed by aligning the must-have to the implemented mention reply policy (always reply or ask clarifying questions). Remaining uncertainty is limited to end-to-end GitHub surface behavior (inline thread replies, webhook/config paths), which requires human verification.

---

_Verified: 2026-02-10T02:15:25Z_
_Verifier: Claude (gsd-verifier)_
