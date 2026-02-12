---
phase: quick-2
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/execution/mcp/comment-server.ts
  - src/execution/mcp/index.ts
  - src/execution/mcp/comment-server.test.ts
autonomous: true
must_haves:
  truths:
    - "When mention review produces Decision: APPROVE with Issues: none, a GitHub PR approval review (green checkmark) is submitted instead of a plain comment"
    - "When mention review produces Decision: NOT APPROVED, behavior is unchanged (comment posted)"
    - "When there is no prNumber (issue context), APPROVE comments are still posted as comments (no PR to approve)"
  artifacts:
    - path: "src/execution/mcp/comment-server.ts"
      provides: "APPROVE-to-review interception in create_comment tool"
    - path: "src/execution/mcp/index.ts"
      provides: "Passes prNumber to createCommentServer"
  key_links:
    - from: "src/execution/mcp/index.ts"
      to: "src/execution/mcp/comment-server.ts"
      via: "prNumber parameter"
      pattern: "createCommentServer.*prNumber"
    - from: "src/execution/mcp/comment-server.ts"
      to: "octokit.rest.pulls.createReview"
      via: "GitHub PR approval API"
      pattern: "createReview.*APPROVE"
---

<objective>
When a mention-triggered review produces "Decision: APPROVE" with "Issues: none", submit a GitHub PR approval review (green checkmark) instead of posting a plain comment.

Purpose: APPROVE decisions should have the same GitHub-native approval status as the auto-review handler, providing a proper green checkmark in the PR reviewers panel rather than a collapsible comment.
Output: Modified comment-server.ts that intercepts APPROVE+no-issues comments and converts them to PR approval reviews.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/execution/mcp/comment-server.ts
@src/execution/mcp/index.ts
@src/execution/mcp/comment-server.test.ts
@src/handlers/mention.ts (lines 663-698 — executor call and result handling, for reference only)
@src/handlers/review.ts (lines 629-637 — auto-approval pattern using pulls.createReview, for reference)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Pass prNumber to comment server and intercept APPROVE decisions</name>
  <files>src/execution/mcp/comment-server.ts, src/execution/mcp/index.ts</files>
  <action>
1. In `src/execution/mcp/index.ts`, pass `deps.prNumber` as a new parameter to `createCommentServer`:
   ```
   servers.github_comment = createCommentServer(
     deps.getOctokit,
     deps.owner,
     deps.repo,
     deps.reviewOutputKey,
     deps.onPublish,
     deps.prNumber,  // NEW
   );
   ```

2. In `src/execution/mcp/comment-server.ts`, update the `createCommentServer` function signature to accept an optional `prNumber?: number` parameter (add it as the last parameter to avoid breaking existing callers).

3. In the `create_comment` tool handler, AFTER the existing `sanitizeKodiaiDecisionResponse(body)` call succeeds, add detection logic:
   - Check if the sanitized body contains `<summary>kodiai response</summary>` AND contains `Decision: APPROVE` AND contains `Issues: none` AND `prNumber` is defined.
   - If ALL conditions match: instead of calling `octokit.rest.issues.createComment`, call `octokit.rest.pulls.createReview` with:
     - `owner`, `repo`, `pull_number: prNumber`
     - `event: "APPROVE"`
     - `body`: the sanitized+marker-stamped body (same content that would have been the comment)
   - Call `onPublish?.()` after the approval review is submitted.
   - Return success response with `{ success: true, approved: true, pull_number: prNumber }`.
   - If the APPROVE conditions do NOT match, fall through to the existing `issues.createComment` logic unchanged.

4. Important: The `maybeStampMarker` and `sanitizeKodiaiDecisionResponse` functions should still run on the body before the approval check. Apply the same sanitization pipeline: `maybeStampMarker(sanitizeKodiaiReviewSummary(sanitizeKodiaiDecisionResponse(body)))`, then check the sanitized result for the APPROVE pattern.

5. The detection should be simple string checks on the sanitized body (not regex), matching what `sanitizeKodiaiDecisionResponse` already validates:
   ```ts
   const isApproveNoIssues =
     prNumber !== undefined &&
     sanitized.includes("<summary>kodiai response</summary>") &&
     sanitized.includes("Decision: APPROVE") &&
     sanitized.includes("Issues: none");
   ```
  </action>
  <verify>
  `cd /home/keith/src/kodiai && npx tsc --noEmit` passes with no type errors.
  </verify>
  <done>
  - createCommentServer accepts optional prNumber parameter
  - buildMcpServers passes prNumber to createCommentServer
  - create_comment tool detects APPROVE+no-issues and submits PR approval review instead of comment
  - Non-APPROVE comments and issue-context comments are unaffected
  </done>
</task>

<task type="auto">
  <name>Task 2: Add tests for APPROVE-to-review interception</name>
  <files>src/execution/mcp/comment-server.test.ts</files>
  <action>
Add test cases to the existing comment-server test file:

1. **Test: APPROVE with no issues on PR submits approval review instead of comment**
   - Create a comment server with `prNumber` set (e.g., 42)
   - Mock `getOctokit` to return an octokit stub where:
     - `pulls.createReview` resolves successfully
     - `issues.createComment` should NOT be called (assert it was not invoked)
   - Call the `create_comment` tool with a body containing the standard APPROVE format:
     ```
     <details>
     <summary>kodiai response</summary>

     Decision: APPROVE
     Issues: none

     </details>
     ```
   - Assert: `pulls.createReview` was called with `event: "APPROVE"`, `pull_number: 42`
   - Assert: `issues.createComment` was NOT called
   - Assert: `onPublish` callback was invoked
   - Assert: response contains `approved: true`

2. **Test: APPROVE with no issues but no prNumber posts as regular comment**
   - Create a comment server WITHOUT prNumber (undefined)
   - Same APPROVE body as above
   - Assert: `issues.createComment` was called (normal comment)
   - Assert: `pulls.createReview` was NOT called

3. **Test: NOT APPROVED still posts as regular comment even with prNumber**
   - Create a comment server with prNumber set
   - Use a body with `Decision: NOT APPROVED` and issue lines
   - Assert: `issues.createComment` was called
   - Assert: `pulls.createReview` was NOT called

Look at existing test patterns in the file for mock structure and assertion style. Follow the same patterns.
  </action>
  <verify>
  `cd /home/keith/src/kodiai && bun test src/execution/mcp/comment-server.test.ts` passes.
  </verify>
  <done>
  - Three test cases covering: APPROVE+prNumber -> approval, APPROVE+no-prNumber -> comment, NOT APPROVED+prNumber -> comment
  - All tests pass
  </done>
</task>

</tasks>

<verification>
```bash
cd /home/keith/src/kodiai && npx tsc --noEmit && bun test src/execution/mcp/comment-server.test.ts
```
Both type checking and tests pass.
</verification>

<success_criteria>
- When Claude's mention review outputs "Decision: APPROVE / Issues: none" on a PR, a GitHub PR approval review is submitted (green checkmark visible in PR reviewers panel)
- When Claude's mention review outputs "Decision: NOT APPROVED", a regular comment is posted (unchanged behavior)
- When the mention is on an issue (no PR), APPROVE comments are posted as regular comments (no crash)
- All existing tests continue to pass
</success_criteria>

<output>
After completion, create `.planning/quick/2-change-approve-with-no-issues-to-submit-/2-SUMMARY.md`
</output>
