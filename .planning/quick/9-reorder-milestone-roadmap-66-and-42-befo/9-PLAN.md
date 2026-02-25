---
phase: quick-9
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [QUICK-9]
must_haves:
  truths:
    - "Issue #42 title contains v0.19"
    - "Issue #66 title contains v0.20"
    - "Issue #73 title contains v0.21"
    - "Issue #74 title contains v0.22"
    - "Issue #75 title contains v0.23"
  artifacts: []
  key_links: []
---

<objective>
Reorder milestone roadmap so #42 and #66 come before the issue triage series (#73-75).

Purpose: User wants existing intelligent retrieval (#42) and multi-model (#66) work done before the new issue triage features, so version numbers must shift accordingly.
Output: All 5 issues updated with correct version labels in their titles.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

Current issue state (from quick task 8):
- #42 — "Intelligent Retrieval: remaining enhancements" (no version)
- #66 — "Milestone 3: Multi-Model & Active Intelligence" (no version)
- #73 — "v0.19 Issue Triage Foundation" (just renamed in task 8)
- #74 — "v0.20 Issue Intelligence" (just renamed in task 8)
- #75 — "v0.21 Interactive Troubleshooting" (just renamed in task 8)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rename all 5 issues with correct version ordering</name>
  <files></files>
  <action>
Run these gh commands to update issue titles:

1. `gh issue edit 42 --title "v0.19 Intelligent Retrieval Enhancements"`
2. `gh issue edit 66 --title "v0.20 Multi-Model & Active Intelligence"`
3. `gh issue edit 73 --title "v0.21 Issue Triage Foundation"` (bump from v0.19)
4. `gh issue edit 74 --title "v0.22 Issue Intelligence"` (bump from v0.20)
5. `gh issue edit 75 --title "v0.23 Interactive Troubleshooting"` (bump from v0.21)

No body or comment changes needed -- just title updates.
  </action>
  <verify>
Run `gh issue list --state open --limit 10` and confirm each issue shows the correct version prefix in its title.
  </verify>
  <done>
All 5 issues have updated titles: #42=v0.19, #66=v0.20, #73=v0.21, #74=v0.22, #75=v0.23.
  </done>
</task>

</tasks>

<verification>
`gh issue list --state open` shows version-ordered milestones: v0.19 (#42), v0.20 (#66), v0.21 (#73), v0.22 (#74), v0.23 (#75).
</verification>

<success_criteria>
All 5 open milestone issues have correct version prefixes reflecting the new ordering where #42 and #66 precede #73-75.
</success_criteria>

<output>
After completion, create `.planning/quick/9-reorder-milestone-roadmap-66-and-42-befo/9-SUMMARY.md`
</output>
