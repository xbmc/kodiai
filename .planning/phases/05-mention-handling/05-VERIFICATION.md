---
phase: 05-mention-handling
verified: 2026-02-09T16:52:39Z
status: human_needed
score: 11/11 must-haves verified
human_verification:
  - test: "Issue comment mention produces response"
    expected: "Posting an issue comment containing '@kodiai <question>' creates a tracking comment within seconds and the tracking comment is updated with a contextual markdown answer."
    why_human: "Requires real GitHub webhook delivery + live Claude execution; cannot be proven from static code alone."
  - test: "PR general comment mention produces response"
    expected: "Posting a PR conversation comment containing '@kodiai <question>' creates a tracking comment and the updated response reflects PR context."
    why_human: "Depends on GitHub event payloads and end-to-end job execution."
  - test: "PR review comment mention includes diff context"
    expected: "Mentioning '@kodiai' in an inline review comment yields a response that references the diff hunk context in a helpful way."
    why_human: "Prompt includes diff hunk, but whether the model uses it well is behavioral."
  - test: "PR review body mention works and null-body reviews are ignored"
    expected: "A submitted PR review with a body containing '@kodiai' triggers the flow; a submitted review with null/empty body does not trigger anything."
    why_human: "Requires emitting real pull_request_review.submitted events and observing handler behavior."
---

# Phase 5: Mention Handling Verification Report

**Phase Goal:** Users can @kodiai in any comment surface (issue comments, PR comments, PR review comments, PR review bodies) and receive a contextual response, with a tracking comment showing progress during long-running jobs.
**Verified:** 2026-02-09T16:52:39Z
**Status:** human_needed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Typing `@kodiai` followed by a question in an issue comment produces a contextual response as a reply | ? UNCERTAIN | `src/handlers/mention.ts` registers `issue_comment.created`, checks `containsMention`, posts tracking comment, enqueues job, clones repo, builds prompt, calls `executor.execute()`.
| 2 | Typing `@kodiai` in a PR comment, PR review comment, or PR review body produces a contextual response | ? UNCERTAIN | `src/handlers/mention.ts` handles PR comments via `issue_comment.created` + PR detection in `src/handlers/mention-types.ts`; handles review comments/bodies via `pull_request_review_comment.created` and `pull_request_review.submitted`.
| 3 | A tracking comment appears within seconds showing progress, and updates when the response is ready | ? UNCERTAIN | Tracking comment posted before enqueue (`src/handlers/mention.ts`), then prompt instructs updating it via `mcp__github_comment__update_comment` with explicit ID (`src/execution/mention-prompt.ts`).
| 4 | The bot response demonstrates awareness of surrounding conversation context (prior comments, PR diff if applicable) | ? UNCERTAIN | Context builder fetches recent comments + PR metadata + diff hunk (`src/execution/mention-prompt.ts`), and handler passes it into the LLM prompt.

**Score:** 4/4 truths require human verification (implementation appears complete in code)

## Must-Haves (Plan Frontmatter)

The phase plans define 11 must-have truths. All 11 are implemented and wired in the codebase; end-to-end behavior still needs human validation.

| # | Must-have truth | Status | Evidence |
|---|------------------|--------|----------|
| 1 | MCP comment server exposes `create_comment` alongside `update_comment` | ✓ VERIFIED | `src/execution/mcp/comment-server.ts` defines both tools.
| 2 | MentionEvent normalizes all four comment surfaces | ✓ VERIFIED | `src/handlers/mention-types.ts` defines `MentionEvent.surface` and three normalizers covering 4 surfaces.
| 3 | Mention prompt includes conversation context, PR metadata when applicable, and user question | ✓ VERIFIED | `src/execution/mention-prompt.ts` builds prompt with `conversationContext` + question; context builder adds PR section when `prNumber` set.
| 4 | Conversation context builder fetches recent issue/PR comments and PR details | ✓ VERIFIED | `octokit.rest.issues.listComments` and `octokit.rest.pulls.get` in `src/execution/mention-prompt.ts`.
| 5 | Issue comment mention produces contextual response | ✓ VERIFIED | Flow: normalize -> containsMention -> tracking comment -> enqueue -> clone -> context -> `executor.execute` in `src/handlers/mention.ts`.
| 6 | PR comment/review comment/review body mentions produce contextual response | ✓ VERIFIED | Event registrations + normalizers in `src/handlers/mention.ts` + `src/handlers/mention-types.ts`.
| 7 | Tracking comment appears quickly and updates later | ✓ VERIFIED | Tracking comment posted before enqueue (`src/handlers/mention.ts`); prompt directs updating it by ID (`src/execution/mention-prompt.ts`); MCP tool exists (`src/execution/mcp/comment-server.ts`).
| 8 | Response is aware of conversation context (and diff where applicable) | ✓ VERIFIED | Conversation history + PR metadata + diff hunk in `src/execution/mention-prompt.ts`.
| 9 | Comments without `@kodiai` mention are ignored | ✓ VERIFIED | Early return via `containsMention(...)` in `src/handlers/mention.ts`.
| 10 | Review bodies with null/empty body are skipped | ✓ VERIFIED | `if (!payload.review.body) return;` in `src/handlers/mention.ts`.
| 11 | Mention handling respects `mention.enabled` config | ✓ VERIFIED | `if (!config.mention.enabled) return;` after `loadRepoConfig` in `src/handlers/mention.ts`; schema includes `mention.enabled` in `src/execution/config.ts`.

## Required Artifacts

| Artifact | Expected | Status | Details |
|---------|----------|--------|---------|
| `src/execution/mcp/comment-server.ts` | MCP tool for comment creation/update | ✓ VERIFIED | Substantive implementation; used by `src/execution/mcp/index.ts`.
| `src/handlers/mention-types.ts` | Normalized mention types + helpers | ✓ VERIFIED | Exported normalizers + mention detection/stripping; imported by `src/handlers/mention.ts` and `src/execution/mention-prompt.ts`.
| `src/execution/mention-prompt.ts` | Context builder + prompt assembly | ✓ VERIFIED | Fetches comments + PR metadata + diff hunk; prompt contains explicit tool instructions.
| `src/handlers/mention.ts` | Mention handler factory + orchestration | ✓ VERIFIED | Registers 3 webhook events, posts tracking comment, enqueues job, clones repo, runs executor, posts errors.
| `src/execution/config.ts` | mention.prompt config field | ✓ VERIFIED | `mention.prompt` optional + defaulted; `mention.enabled` present.
| `src/index.ts` | Server wiring for mention handler | ✓ VERIFIED | Imports and calls `createMentionHandler(...)`.

## Key Link Verification (Wiring)

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/handlers/mention-types.ts` | `@octokit/webhooks-types` | type imports | ✓ WIRED | Imports `IssueCommentCreatedEvent`, `PullRequestReviewCommentCreatedEvent`, `PullRequestReviewSubmittedEvent`.
| `src/execution/mention-prompt.ts` | `src/handlers/mention-types.ts` | `MentionEvent` import | ✓ WIRED | `import type { MentionEvent } ...`.
| `src/handlers/mention.ts` | event router | `eventRouter.register(...)` | ✓ WIRED | Registers `issue_comment.created`, `pull_request_review_comment.created`, `pull_request_review.submitted`.
| `src/handlers/mention.ts` | executor | `executor.execute(...)` | ✓ WIRED | Job invokes executor with mention-built prompt.
| `src/handlers/mention.ts` | prompt builder | `buildConversationContext` + `buildMentionPrompt` | ✓ WIRED | Both called within job.
| `src/handlers/mention.ts` | mention normalizers/helpers | `normalize*`, `containsMention`, `stripMention` | ✓ WIRED | Normalization + mention detection before enqueue.
| `src/index.ts` | mention handler | `createMentionHandler(...)` | ✓ WIRED | Handler is constructed during startup.

## Requirements Coverage (Phase 5)

| Requirement | Status | Blocking Issue |
|------------|--------|----------------|
| MENTION-01: Respond to @kodiai in issue comments | ? NEEDS HUMAN | Verify on a real issue thread with webhook delivery.
| MENTION-02: Respond to @kodiai in PR comments | ? NEEDS HUMAN | Verify on PR conversation comments.
| MENTION-03: Respond to @kodiai in PR review comments | ? NEEDS HUMAN | Verify on inline review comment payloads.
| MENTION-04: Respond to @kodiai in PR review bodies | ? NEEDS HUMAN | Verify pull_request_review.submitted review body behavior.
| MENTION-05: Tracking comment posted/updated for progress | ? NEEDS HUMAN | Prompt + MCP tools support update; verify it updates in practice.

## Anti-Patterns Found

No obvious stub implementations found in the phase files reviewed (`src/handlers/mention.ts`, `src/execution/mention-prompt.ts`, `src/handlers/mention-types.ts`, `src/execution/mcp/comment-server.ts`).

## Human Verification Required

### 1. Issue Comment Mention

**Test:** Create an issue comment containing `@kodiai` and a concrete question.
**Expected:** A tracking comment appears quickly and later updates with the answer.
**Why human:** Requires real GitHub webhooks + live Claude execution.

### 2. PR Surfaces Coverage

**Test:** Mention `@kodiai` in (a) PR conversation comment, (b) inline review comment, (c) PR review body.
**Expected:** Each surface triggers; inline review comment responses reflect the diff hunk context.
**Why human:** Static code cannot validate GitHub payload quirks or model behavior.

### 3. Tracking Comment Update Path

**Test:** Confirm the bot updates the tracking comment (not just posts a second comment) when tracking comment creation succeeds.
**Expected:** Original tracking comment body is updated via `update_comment` tool use.
**Why human:** Depends on LLM tool usage at runtime.

---

_Verified: 2026-02-09T16:52:39Z_
_Verifier: Claude (gsd-verifier)_
