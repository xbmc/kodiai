---
phase: quick-8
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [TRIAGE-01]

must_haves:
  truths:
    - "Issue #65 is closed with a summary comment of what v0.17+v0.18 delivered"
    - "Issues #73, #74, #75 have updated titles with version numbers bumped by one"
    - "Issue #73 has a comment marking it as the next target milestone"
  artifacts: []
  key_links: []
---

<objective>
Triage all 6 open GitHub issues: close completed work, bump stale version labels, and mark the next milestone target.

Purpose: Keep the issue tracker accurate now that v0.18 Knowledge Ingestion has shipped.
Output: Clean issue state reflecting current project reality.
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
  <name>Task 1: Close completed issue and update stale version labels</name>
  <files></files>
  <action>
1. Close #65 (Milestone 2: Knowledge Ingestion) with a comment summarizing delivery:
   - v0.17 shipped PR review comment ingestion (webhook-driven, incremental sync, BM25+vector hybrid search)
   - v0.18 shipped MediaWiki content ingestion and cross-corpus unified retrieval (RRF merge, cosine dedup, source attribution)
   - All 19 requirements satisfied across both milestones

   ```
   gh issue comment 65 --repo kodiai/kodiai --body "Closing -- all Knowledge Ingestion work shipped across v0.17 and v0.18:

   **v0.17 — PR Review Comment Ingestion**
   - Webhook-driven incremental sync of PR review comments
   - BM25 + vector hybrid search over review_comments corpus
   - Full CRUD lifecycle with dedup and staleness detection

   **v0.18 — MediaWiki Content Ingestion + Unified Retrieval**
   - MediaWiki scheduled sync with incremental change detection
   - Cross-corpus unified retrieval: BM25+vector per corpus, RRF merge, cosine dedup, source attribution
   - All 19 milestone requirements satisfied"
   gh issue close 65 --repo kodiai/kodiai
   ```

2. Rename issues with bumped version numbers (v0.18 is now taken):
   ```
   gh issue edit 73 --repo kodiai/kodiai --title "v0.19 Issue Triage Foundation"
   gh issue comment 73 --repo kodiai/kodiai --body "Renamed from v0.18 to v0.19 — v0.18 shipped as Knowledge Ingestion. This is the next target milestone."

   gh issue edit 74 --repo kodiai/kodiai --title "v0.20 Issue Intelligence"
   gh issue comment 74 --repo kodiai/kodiai --body "Renamed from v0.19 to v0.20 — version numbers bumped after v0.18 shipped as Knowledge Ingestion."

   gh issue edit 75 --repo kodiai/kodiai --title "v0.21 Interactive Troubleshooting"
   gh issue comment 75 --repo kodiai/kodiai --body "Renamed from v0.20 to v0.21 — version numbers bumped after v0.18 shipped as Knowledge Ingestion."
   ```

3. Leave #42 and #66 as-is (still valid future work, no changes needed).
  </action>
  <verify>
   Run `gh issue list --repo kodiai/kodiai --state all --limit 10` and confirm:
   - #65 shows as closed
   - #73 title is "v0.19 Issue Triage Foundation"
   - #74 title is "v0.20 Issue Intelligence"
   - #75 title is "v0.21 Interactive Troubleshooting"
   - #42 and #66 unchanged and open
  </verify>
  <done>Issue #65 closed with delivery summary. Issues #73/#74/#75 have correct version numbers. Issue #73 marked as next target. Issues #42/#66 untouched.</done>
</task>

</tasks>

<verification>
All 6 open issues reviewed. Completed work closed. Version labels current. Next milestone identified.
</verification>

<success_criteria>
- #65 closed with comment
- #73, #74, #75 titles updated with bumped version numbers
- #73 comment identifies it as next milestone target
- #42 and #66 remain open and unchanged
</success_criteria>

<output>
After completion, create `.planning/quick/8-read-thru-the-open-issues-close-comment-/8-SUMMARY.md`
</output>
