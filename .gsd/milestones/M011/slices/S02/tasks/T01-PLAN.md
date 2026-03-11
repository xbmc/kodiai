# T01: 61-read-only-intent-gating 01

**Slice:** S02 — **Milestone:** M011

## Description

Extend the issue mention prompt contract so non-prefixed issue replies are clearly read-only and include explicit apply/change opt-in commands when users ask for implementation.

Purpose: ISSUE-02 requires clear read-only framing in issue Q&A before write-mode is allowed; this plan locks that behavior with prompt-level contract tests.
Output: Updated `buildMentionPrompt()` issue instructions and tests that fail if read-only or opt-in command guidance regresses.

## Must-Haves

- [ ] "Issue Q&A replies without apply/change are explicitly framed as read-only guidance"
- [ ] "When a change is requested without apply/change, the response contract includes exact opt-in commands"
- [ ] "Read-only intent guidance is applied only on issue_comment surface"

## Files

- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
