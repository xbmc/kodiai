---
phase: quick-21
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
autonomous: true
requirements: [QUICK-21]

must_haves:
  truths:
    - "PR surface recognizes 'update this PR' as write intent"
    - "PR surface recognizes 'fix this' as write intent"
    - "PR surface recognizes 'rewrite this' as write intent"
    - "PR surface recognizes conversational confirmations like 'yes, go ahead' as write intent"
    - "PR surface still recognizes patch-specific patterns like 'create a patch'"
    - "Issue surface intent detection remains unchanged"
  artifacts:
    - path: "src/handlers/mention.ts"
      provides: "Expanded PR write intent detection"
      contains: "isImplementationRequestWithoutPrefix|isConversationalConfirmation"
    - path: "src/handlers/mention.test.ts"
      provides: "Tests for expanded PR write intent detection"
  key_links:
    - from: "detectImplicitPrPatchIntent"
      to: "isImplementationRequestWithoutPrefix"
      via: "function call within detectImplicitPrPatchIntent"
      pattern: "isImplementationRequestWithoutPrefix\\(normalized\\)"
    - from: "detectImplicitPrPatchIntent"
      to: "isConversationalConfirmation"
      via: "function call within detectImplicitPrPatchIntent"
      pattern: "isConversationalConfirmation\\(normalized\\)"
---

<objective>
Expand PR surface implicit write-intent detection to recognize implementation verbs and conversational confirmations, not just patch-specific keywords.

Purpose: Currently `detectImplicitPrPatchIntent` only matches "create a patch" style phrases. Users saying "update this PR", "fix this", "yes, go ahead" on PR surfaces get no write intent detected, falling through to read-only mode. The existing `isImplementationRequestWithoutPrefix()` and `isConversationalConfirmation()` helper functions already handle these patterns for issue surfaces -- they just need to be called from the PR detection path too.

Output: Updated `detectImplicitPrPatchIntent` that calls existing helpers, with tests covering the expanded patterns.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/handlers/mention.ts (lines 319-369: detectImplicitIssueIntent, detectImplicitPrPatchIntent)
@src/handlers/mention.ts (lines 728-789: isImplementationRequestWithoutPrefix, isConversationalConfirmation)
@src/handlers/mention.ts (lines 1085-1110: intent routing logic)
@src/handlers/mention.test.ts

<interfaces>
<!-- From src/handlers/mention.ts — inner functions in createMentionHandler closure -->

function detectImplicitIssueIntent(userQuestion: string): "apply" | "plan" | undefined
// Calls isImplementationRequestWithoutPrefix() and isConversationalConfirmation() — this is the model to follow

function detectImplicitPrPatchIntent(userQuestion: string): "apply" | undefined
// Currently ONLY matches patch-specific regex patterns — needs expansion

function isImplementationRequestWithoutPrefix(userQuestion: string): boolean
// Matches: fix, update, change, refactor, add, remove, implement, create, rename, rewrite, patch, write, open, submit, send
// Also matches: improve, tweak, clean up, clarify + code targets
// Also matches: "make X clearer/better/safer" style

function isConversationalConfirmation(text: string): boolean
// Matches: "yes, do it", "go ahead", "proceed", "sure, make the PR", "sounds good, go ahead"
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Expand detectImplicitPrPatchIntent to call existing helpers</name>
  <files>src/handlers/mention.ts</files>
  <behavior>
    - detectImplicitPrPatchIntent("update this PR") returns "apply"
    - detectImplicitPrPatchIntent("fix this") returns "apply"
    - detectImplicitPrPatchIntent("rewrite the handler") returns "apply"
    - detectImplicitPrPatchIntent("yes, go ahead") returns "apply"
    - detectImplicitPrPatchIntent("yes, do it") returns "apply"
    - detectImplicitPrPatchIntent("create a patch") returns "apply" (existing behavior preserved)
    - detectImplicitPrPatchIntent("what does this code do?") returns undefined (read-only question)
    - detectImplicitPrPatchIntent("can you explain the logic?") returns undefined
  </behavior>
  <action>
In `src/handlers/mention.ts`, expand `detectImplicitPrPatchIntent` (lines 343-369) to also call `isImplementationRequestWithoutPrefix(normalized)` and `isConversationalConfirmation(normalized)` after the existing patch-specific regex checks.

The pattern to follow is `detectImplicitIssueIntent` (lines 319-341) which already does this. Add two checks after the existing patch regex block:

```typescript
// After existing patch regex checks (keep those as-is):
if (isImplementationRequestWithoutPrefix(normalized)) {
  return "apply";
}

if (isConversationalConfirmation(normalized)) {
  return "apply";
}
```

Also rename variable `prPatchIntent` to `prWriteIntent` at lines 1097 and 1102 for clarity (since it now detects more than patches). Update the comment at line 1096 from "narrow patch-specific" to "broad write intent detection".

Do NOT rename the function itself -- keep `detectImplicitPrPatchIntent` to minimize diff and test churn. The variable rename is purely cosmetic for readability at the call site.
  </action>
  <verify>
    <automated>cd /home/keith/src/kodiai && bun test src/handlers/mention.test.ts --timeout 60000 2>&1 | tail -5</automated>
  </verify>
  <done>detectImplicitPrPatchIntent returns "apply" for implementation verbs and conversational confirmations. All existing tests pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add tests for expanded PR write intent detection</name>
  <files>src/handlers/mention.test.ts</files>
  <behavior>
    - Integration test: PR comment "update this PR" triggers write mode
    - Integration test: PR comment "fix the handler" triggers write mode
    - Integration test: PR comment "yes, go ahead" triggers write mode
    - Integration test: PR comment "create a patch" still triggers write mode (regression)
    - Integration test: PR comment "what does this do?" does NOT trigger write mode
  </behavior>
  <action>
Add integration tests in `src/handlers/mention.test.ts` following the existing pattern for PR surface write intent tests. Look at the existing "issue trigger A wording without apply/change is treated as implicit write intent" test (around line 2343) for the test structure pattern, but adapt for PR surfaces (use `pull_request_review_comment` or `issue_comment` on a PR with `prNumber` set).

Find an existing PR surface test to copy the event shape from. Key differences from issue tests:
- The event must have a `prNumber` (the mention object must resolve to a PR, not an issue)
- Use the same workspace fixture pattern with `mention:\n  enabled: true`

Add a describe block: `describe("PR surface implicit write intent detection")` with these tests:

1. "PR comment 'update this PR' triggers write mode" — verify `capturedWriteMode` is truthy
2. "PR comment 'fix this' triggers write mode" — verify write mode activated
3. "PR comment 'yes, go ahead' triggers write mode" — verify conversational confirmation works
4. "PR comment 'create a patch' still triggers write mode" — regression test for existing patch patterns
5. "PR comment 'what does this do' does not trigger write mode" — verify read-only questions stay read-only

Use the same `capturedWriteMode` capture pattern used by existing write intent tests. Each test should set up a minimal PR surface event and verify write mode is or is not activated.
  </action>
  <verify>
    <automated>cd /home/keith/src/kodiai && bun test src/handlers/mention.test.ts --timeout 60000 2>&1 | tail -10</automated>
  </verify>
  <done>All new PR surface write intent tests pass. Existing tests unbroken. Tests cover implementation verbs, conversational confirmations, existing patch patterns, and negative case for read-only questions.</done>
</task>

</tasks>

<verification>
- `bun test src/handlers/mention.test.ts` passes all tests including new PR surface intent tests
- Grep confirms `isImplementationRequestWithoutPrefix` and `isConversationalConfirmation` are called inside `detectImplicitPrPatchIntent`
- Existing patch-specific patterns still work (no regression)
</verification>

<success_criteria>
- PR surface comments like "update this PR", "fix this", "rewrite the handler" trigger write intent
- PR surface conversational confirmations like "yes, go ahead", "do it" trigger write intent
- Existing patch-specific patterns ("create a patch") continue working
- Issue surface intent detection completely unchanged
- All tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/21-expand-pr-surface-write-intent-detection/21-SUMMARY.md`
</output>
