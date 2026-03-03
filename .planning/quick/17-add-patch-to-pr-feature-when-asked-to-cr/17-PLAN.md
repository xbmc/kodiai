---
phase: "17"
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
autonomous: true
requirements: ["PATCH-01"]
must_haves:
  truths:
    - "When a user says 'create a patch for the earlier suggestion' on a PR surface, kodiai detects write intent and enters write mode"
    - "The implicit write-intent detection applies to PR top-level comments and review comment surfaces, not just issue comments"
    - "Existing explicit prefix detection (apply:/change:/plan:) still works unchanged"
    - "The existing test 'implementation verbs on PR/review surfaces never auto-promote to write mode' is updated to reflect the new behavior for patch-specific phrases"
  artifacts:
    - path: "src/handlers/mention.ts"
      provides: "PR-surface implicit patch intent detection"
    - path: "src/handlers/mention.test.ts"
      provides: "Tests for patch intent on PR surfaces"
  key_links:
    - from: "src/handlers/mention.ts (detectImplicitPrPatchIntent)"
      to: "src/handlers/mention.ts (writeIntent calculation)"
      via: "implicit intent detection for PR surfaces"
      pattern: "detectImplicitPrPatchIntent"
---

<objective>
Detect "create a patch" (and similar phrasings) as write intent on PR surfaces so kodiai creates a PR with the suggested changes instead of just posting a diff in a comment.

Purpose: When a user asks kodiai to "create a patch for the earlier change suggestion" on a PR comment, the system should detect this as a write intent and use the existing write-mode infrastructure to apply changes and create a PR. Currently this only works with explicit `apply:`/`change:` prefixes or implicit detection on issue comments -- PR surface comments with natural language patch requests fall through to plain Q&A mode.

Output: Updated mention handler with PR-surface patch intent detection + tests.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/handlers/mention.ts
@src/handlers/mention.test.ts
@src/handlers/mention-types.ts
</context>

<interfaces>
<!-- Key functions and flow in mention.ts that the executor needs to understand -->

From src/handlers/mention.ts (private functions inside createMentionHandler closure):

```typescript
// Current write intent detection -- only detects apply:/change:/plan: prefixes
function parseWriteIntent(userQuestion: string): {
  writeIntent: boolean;
  keyword: "apply" | "change" | "plan" | undefined;
  request: string;
}

// Current implicit intent detection -- ONLY used for issue thread comments
function detectImplicitIssueIntent(userQuestion: string): "apply" | "plan" | undefined

// Current implementation verb detection -- already includes "patch" and "create"
function isImplementationRequestWithoutPrefix(userQuestion: string): boolean

// Current write intent wiring (lines ~826-842):
const isIssueThreadComment = event.name === "issue_comment" && mention.prNumber === undefined;
const parsedWriteIntent = parseWriteIntent(userQuestion);
const implicitIntent =
  isIssueThreadComment && !parsedWriteIntent.writeIntent
    ? detectImplicitIssueIntent(parsedWriteIntent.request)
    : undefined;
const writeIntent =
  isIssueThreadComment && implicitIntent !== undefined && !parsedWriteIntent.writeIntent
    ? { writeIntent: true, keyword: implicitIntent, request: parsedWriteIntent.request }
    : parsedWriteIntent;
```

The existing test at line 837 explicitly asserts that "implementation verbs on PR/review surfaces never auto-promote to write mode." This test needs updating because we're intentionally changing this behavior for patch-specific phrases.
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add PR-surface patch intent detection</name>
  <files>src/handlers/mention.ts, src/handlers/mention.test.ts</files>
  <behavior>
    - Test: "@kodiai create a patch for the earlier change suggestion" on a pr_comment surface triggers write mode (executor receives writeMode=true)
    - Test: "@kodiai can you create a patch for this?" on a pr_review_comment surface triggers write mode
    - Test: "@kodiai please patch this" on a pr_comment surface triggers write mode
    - Test: "@kodiai create a patch" on a pr_comment surface triggers write mode
    - Test: "@kodiai apply the earlier suggestion as a patch PR" on a pr_comment surface triggers write mode
    - Test: Regular non-patch implementation verbs on PR surfaces (e.g. "@kodiai fix the login bug") still do NOT auto-promote to write mode (preserving safety for broad verbs)
    - Test: Explicit prefixes ("@kodiai apply: fix the bug") on PR surfaces still work as before
  </behavior>
  <action>
1. Create a new private function `detectImplicitPrPatchIntent(userQuestion: string): "apply" | undefined` inside the `createMentionHandler` closure, near the existing `detectImplicitIssueIntent`. This function should detect patch-specific phrases on PR surfaces:
   - Direct: "create a patch", "make a patch", "open a patch PR", "patch this", "apply this as a patch"
   - Polite: "can/could/would you create a patch", "please create a patch"
   - With context: "create a patch for the earlier suggestion", "patch the earlier change"
   - Key patterns to match (case-insensitive, after stripIssueIntentWrappers):
     - `^(?:please\s+)?(?:create|make|open|submit)\s+(?:a\s+)?patch\b`
     - `^(?:please\s+)?patch\s+(?:this|the|that)\b`
     - `^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:create|make|open|submit)\s+(?:a\s+)?patch\b`
     - `^(?:can|could|would|will)\s+you\s+(?:please\s+)?patch\s+(?:this|the|that)\b`
     - `(?:apply|implement)\s+(?:the\s+)?(?:earlier|previous|above|suggested)\s+(?:change|suggestion|fix).*(?:as\s+)?(?:a\s+)?(?:patch|pr)\b`
   - Return "apply" if matched, undefined otherwise. Do NOT match broad implementation verbs like "fix", "update", "create the function" -- only patch-specific requests.

2. Update the write intent wiring block (around lines 826-842) to also check PR surfaces for patch intent:
   ```typescript
   const isPrSurface = mention.prNumber !== undefined;
   const parsedWriteIntent = parseWriteIntent(userQuestion);

   // Issue surfaces: broad implicit intent detection (existing behavior)
   const implicitIntent =
     isIssueThreadComment && !parsedWriteIntent.writeIntent
       ? detectImplicitIssueIntent(parsedWriteIntent.request)
       : undefined;

   // PR surfaces: narrow patch-specific intent detection (new behavior)
   const prPatchIntent =
     isPrSurface && !isIssueThreadComment && !parsedWriteIntent.writeIntent
       ? detectImplicitPrPatchIntent(parsedWriteIntent.request)
       : undefined;

   const effectiveImplicit = implicitIntent ?? prPatchIntent;

   const writeIntent =
     effectiveImplicit !== undefined && !parsedWriteIntent.writeIntent
       ? { writeIntent: true, keyword: effectiveImplicit, request: parsedWriteIntent.request }
       : parsedWriteIntent;
   ```

3. Update the existing test "implementation verbs on PR/review surfaces never auto-promote to write mode" (line 837) to clarify it tests non-patch verbs only. Rename to "non-patch implementation verbs on PR/review surfaces never auto-promote to write mode" and ensure the test still uses verbs like "fix the login bug" (not patch-related phrases).

4. Add new tests for patch intent on PR surfaces:
   - Use the same integration test pattern as the existing write intent tests (createWorkspaceFixture, mock octokit, etc.)
   - Test pr_comment surface (issue_comment event on a PR) with "create a patch for the earlier suggestion" -- should enter write mode
   - Test pr_review_comment surface with "can you create a patch for this?" -- should enter write mode
   - Test that regular verbs like "fix the login bug" on PR surface still do NOT trigger write mode
   - For write mode verification: check that the executor's `writeMode` parameter is true, similar to how existing tests capture `writeModes` array
  </action>
  <verify>
    <automated>cd /home/keith/src/kodiai && bun test src/handlers/mention.test.ts 2>&1 | tail -30</automated>
  </verify>
  <done>
    - "create a patch" and similar phrasings on PR surfaces trigger write mode
    - Non-patch verbs ("fix", "update") on PR surfaces still do NOT trigger write mode
    - All existing mention handler tests pass
    - Explicit prefix detection (apply:/change:/plan:) unchanged
  </done>
</task>

</tasks>

<verification>
- `bun test src/handlers/mention.test.ts` -- all tests pass including new patch intent tests
- Verify that the new `detectImplicitPrPatchIntent` function is narrow (only patch-specific phrases) to avoid false positives
</verification>

<success_criteria>
- "@kodiai create a patch for the earlier change suggestion" on a PR comment triggers write mode and creates a PR via existing infrastructure
- Regular mention Q&A on PR surfaces (non-patch phrases) still works as before
- All existing tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/17-add-patch-to-pr-feature-when-asked-to-cr/17-SUMMARY.md`
</output>
