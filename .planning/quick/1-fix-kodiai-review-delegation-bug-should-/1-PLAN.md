---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
autonomous: true
must_haves:
  truths:
    - "When user mentions @kodiai review on a PR, kodiai performs an actual review instead of delegating to aireview team"
    - "When user mentions @kodiai recheck on a PR, kodiai performs an actual review instead of delegating to aireview team"
    - "The rereview-team module is unaffected; it is still used by the review handler for PR open events"
  artifacts:
    - path: "src/handlers/mention.ts"
      provides: "Mention handler without early-return delegation for review/recheck"
    - path: "src/handlers/mention.test.ts"
      provides: "Updated test confirming review command triggers executor"
  key_links:
    - from: "src/handlers/mention.ts"
      to: "executor.execute"
      via: "mention handler falling through to buildMentionContext + execute for review/recheck"
      pattern: "buildMentionContext"
---

<objective>
Fix bug where "@kodiai review" mentions delegate to the aireview team instead of performing an actual review.

Purpose: When a user mentions "@kodiai review" or "@kodiai recheck" on a PR, kodiai should build review context and perform the review itself (via the executor), not silently hand off to an "aireview" team that may not exist or do nothing.

Output: Patched mention handler and updated test confirming the executor is called for review/recheck commands.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/handlers/mention.ts
@src/handlers/mention.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove review delegation early-return from mention handler</name>
  <files>src/handlers/mention.ts</files>
  <action>
In src/handlers/mention.ts:

1. Remove lines 607-626 — the entire block that checks `normalizedQuestion === "review" || normalizedQuestion === "recheck"` and calls `requestRereviewTeamBestEffort` then returns early. This block prevents the handler from reaching `buildMentionContext` and the executor.

2. Remove the import of `requestRereviewTeamBestEffort` from `./rereview-team.ts` (line 35), since it is no longer used anywhere in mention.ts.

Do NOT modify src/handlers/rereview-team.ts or its usage in src/handlers/review.ts — the rereview-team module is still correctly used in the PR open/ready_for_review flow (review.ts line 314).

After this change, "@kodiai review" and "@kodiai recheck" mentions will fall through to `buildMentionContext` (line 628+) and proceed to the executor like any other mention command.
  </action>
  <verify>
Run: `grep -n "requestRereviewTeamBestEffort" src/handlers/mention.ts` — should return zero matches.
Run: `grep -n "rereview-team" src/handlers/mention.ts` — should return zero matches.
Visually confirm: the flow after the eyes-reaction block (line 606) goes directly to `buildMentionContext`.
  </verify>
  <done>The mention handler no longer has any early-return delegation for "review" or "recheck" commands. Those commands now flow through to context building and executor like all other mention requests.</done>
</task>

<task type="auto">
  <name>Task 2: Update test to verify review command triggers executor</name>
  <files>src/handlers/mention.test.ts</files>
  <action>
In src/handlers/mention.test.ts, rewrite the "createMentionHandler rereview command" describe block (lines 1406-1509):

1. Rename the describe to "createMentionHandler review command" (or similar).

2. Rename the test to something like "@kodiai review triggers executor instead of delegating to aireview team".

3. Change the test assertions:
   - Instead of asserting `requestedTeams` equals `["aireview"]`, assert that the executor's `execute` method WAS called.
   - Add a boolean flag `executorCalled = false` and set it to `true` inside the executor mock's execute function (instead of throwing an error).
   - Remove the `requestedTeams` tracking variable and the `requestReviewers` tracking mock since they are no longer relevant to this test.
   - Keep the `createReplyForReviewComment` mock functional (don't throw — the handler may post a reply comment now).
   - Keep the `createComment` mock functional for the same reason.
   - After calling the handler, assert `expect(executorCalled).toBe(true)`.

4. The workspace fixture, octokit.rest.pulls.get, listRequestedReviewers, reactions mocks, and event construction can remain mostly the same — they provide the necessary PR context for the mention handler to work.

Run `bun test src/handlers/mention.test.ts` to verify the updated test passes.
  </action>
  <verify>Run: `bun test src/handlers/mention.test.ts` — all tests pass including the updated review command test.</verify>
  <done>Test confirms that "@kodiai review" triggers the executor (performs actual review) instead of delegating to the aireview team.</done>
</task>

</tasks>

<verification>
1. `bun test src/handlers/mention.test.ts` — all tests pass
2. `grep -rn "requestRereviewTeamBestEffort" src/handlers/mention.ts` — no matches (import removed)
3. `grep -rn "requestRereviewTeamBestEffort" src/handlers/review.ts` — still present (review.ts unaffected)
4. `bun test src/handlers/rereview-team.test.ts` — still passes (module unaffected)
</verification>

<success_criteria>
- "@kodiai review" mention no longer delegates to aireview team
- "@kodiai review" mention triggers the executor to perform an actual review
- All existing mention tests continue to pass
- rereview-team module and its usage in review.ts are unaffected
</success_criteria>

<output>
After completion, create `.planning/quick/1-fix-kodiai-review-delegation-bug-should-/1-SUMMARY.md`
</output>
