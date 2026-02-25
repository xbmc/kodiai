---
phase: quick-10
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [QUICK-10]
must_haves:
  truths:
    - "Issue #42 body contains depends-PR handling scope item"
    - "Issue #42 body contains unrelated CI failure recognition scope item"
    - "Existing two scope items are preserved unchanged"
  artifacts: []
  key_links: []
---

<objective>
Update GitHub issue #42 (v0.19 Intelligent Retrieval Enhancements) to add two new scope items: [depends] PR handling and unrelated CI failure recognition.

Purpose: Capture real-world patterns observed from xbmc/xbmc PRs as v0.19 scope items.
Output: Updated issue #42 on GitHub with four scope items total.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update issue #42 body with two new scope items</name>
  <files></files>
  <action>
Run `gh issue edit 42 --body "..."` with the full updated body. The body must:

1. Keep the existing header and status section intact
2. Keep both existing items (language-aware boosting, code snippet embedding)
3. Append two new items after the existing two:

**Item 3: `[depends]` PR handling** — Dependency bump PRs (e.g. xbmc/xbmc#27900 "[depends] Bump zlib 1.3.2", xbmc/xbmc#27870 "[Windows] Refresh fstrcmp 0.7") are a distinct category. Kodiai should:
- Detect `[depends]` prefix or dependency-bump patterns in PR title
- Apply specialized review: verify hash/URL changes, check for removed patches, validate build config changes
- Use lighter review tone (these are straightforward version bumps, not feature code)

**Item 4: Unrelated CI failure recognition** — Based on real feedback (garbear on xbmc/xbmc#27884: "We can merge with unrelated failures. The failure is a gradle problem with parallel builds for Android."). Kodiai should:
- Detect when CI failures are unrelated to the PR's changed files/scope
- Comment noting which failures appear unrelated (with reasoning)
- Not block approval on unrelated failures

4. Update the labels line to remove `low priority` since scope is growing, or keep as-is (use judgment).

Use the exact body text from `gh issue view 42 --json body` as the base to avoid losing any formatting.
  </action>
  <verify>Run `gh issue view 42` and confirm all four scope items appear in the output.</verify>
  <done>Issue #42 body contains all four scope items: language-aware boosting, code snippet embedding, [depends] PR handling, and unrelated CI failure recognition.</done>
</task>

</tasks>

<verification>
`gh issue view 42` shows updated body with four scope items.
</verification>

<success_criteria>
Issue #42 on GitHub has been updated with two new scope items appended, existing content preserved.
</success_criteria>

<output>
After completion, create `.planning/quick/10-update-issue-42-with-depends-pr-handling/10-SUMMARY.md`
</output>
