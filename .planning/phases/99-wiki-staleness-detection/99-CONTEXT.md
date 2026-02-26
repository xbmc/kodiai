# Phase 99: Wiki Staleness Detection - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Kodiai automatically identifies wiki pages invalidated by code changes and delivers evidence-backed staleness reports on schedule. Two-tier detection: cheap heuristic pass first, LLM evaluation only on flagged subset (capped at 20 pages/cycle). Configurable staleness threshold via `.kodiai.yml`.

</domain>

<decisions>
## Implementation Decisions

### Evidence presentation
- Each stale page shows: commit SHA, changed file path, and a one-line summary of what changed
- Confidence tiers displayed per evidence item: High / Medium / Low — readers prioritize updates accordingly
- LLM evaluation produces the explanation (e.g., "API endpoint renamed from /users to /accounts but wiki still references /users")

### Report format & delivery
- Primary channel: Slack message to `#ai-wiki` (dedicated channel)
- Threaded layout: summary message in channel, each stale page gets its own thread reply with evidence
- Top 5 most stale pages prominent in summary; remaining flagged pages in thread replies
- No report posted when no staleness detected — skip silently
- Each stale page entry includes a direct link to the wiki page (Claude's discretion on format per channel)

### Heuristic vs LLM boundary
- Heuristic pass design at Claude's discretion (file path matching, keyword overlap, etc.)
- When more than 20 pages flagged, prioritize by recency — most recently affected commits evaluated first
- Pages flagged but not LLM-evaluated due to cap are deferred to next cycle (not shown in report)
- LLM evaluation explains WHY a page is stale, not just confirm/deny — this explanation becomes the one-line summary in the report

### Scheduling & triggers
- Weekly scheduled run (default)
- On-demand trigger via `@kodiai wiki-check` mention (not slash command)
- Scan window: commits since last successful run (no duplicates, no gaps)
- On scan failure: post failure notification to `#ai-wiki` so team knows it didn't run

### Claude's Discretion
- Evidence grouping strategy (by wiki page vs by commit)
- Heuristic pass algorithm design
- Link formatting per delivery channel
- Exact Slack message block kit layout
- Staleness score calculation internals

</decisions>

<specifics>
## Specific Ideas

- Dedicated `#ai-wiki` Slack channel for all wiki staleness output
- `@kodiai wiki-check` as the on-demand trigger pattern (consistent with existing mention-based interaction)
- Threaded Slack messages keep the channel scannable while preserving detail

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 99-wiki-staleness-detection*
*Context gathered: 2026-02-25*
