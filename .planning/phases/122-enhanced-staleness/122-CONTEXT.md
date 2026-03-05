# Phase 122: Enhanced Staleness - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Ground staleness detection in actual code changes from recent merged PRs, with diff content preserved as evidence for Phase 123's update generator. Replaces the current token-overlap-on-file-paths approach with PR-based scanning that captures real diffs. Reduces false positives via domain stopwords and section-heading weighting.

</domain>

<decisions>
## Implementation Decisions

### Diff evidence capture
- Store full patch hunks from each PR's changed files — not summaries, not file-level metadata
- Persist diff evidence in a new database table keyed by PR number
- Only store diffs for files that match wiki pages via the heuristic — a PR touching 200 files but only 3 relate to wiki content stores only those 3 diffs
- Include PR metadata alongside diffs: PR number, title, description, author, merge date — enables Phase 123 to cite "PR #12345: Rename PlayerCoreFactory" in update suggestions
- Extract and store linked issue references from PR descriptions (fixes #123, closes #456) for additional context

### PR vs commit scanning
- Switch from individual commit scanning to merged PR scanning — PRs are coherent units of change with richer metadata
- Claude's discretion on whether to replace the existing detector inline or build a new parallel pipeline
- Separate backfill script for initial 90-day PR population; regular scheduled scans cover incremental windows from last run

### False positive reduction
- Curated domain stopword list — hardcoded tokens like 'player', 'video', 'kodi', 'addon' that match too broadly and trigger false positives
- Section-heading weighting per success criteria STALE-04

### Scan window and scheduling
- Regular scan window stays at 7 days (incremental from last run)
- 90-day coverage handled by the one-time backfill script
- Existing weekly scheduler cadence preserved

### Claude's Discretion
- Whether to replace the existing staleness detector inline or build a new parallel pipeline
- Domain stopword list contents and scoring adjustments
- Section-heading weighting algorithm
- Database schema design for PR evidence table
- API rate limiting strategy for 90-day backfill

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The key principle is that Phase 123 (Update Generation) must be able to query stored diff evidence per wiki page and cite specific PRs/commits in its suggestions.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `wiki-staleness-detector.ts`: Current two-tier pipeline (heuristic + LLM) with scheduler, run state persistence, and Slack reporting — this is what gets enhanced
- `heuristicScore()`: Token overlap function (exported, tested) — needs stopword filtering added
- `WikiPageCandidate` / `StalePage` types: Existing staleness types that will need extension for diff evidence
- `fetchChangedFiles()`: Current commit-based fetcher — will be replaced/augmented with PR-based fetching
- `GitHubApp.getInstallationOctokit()`: Authenticated Octokit instance for GitHub API calls

### Established Patterns
- Scheduler start/stop pattern: Used by staleness detector and popularity scorer — same pattern applies
- Run state persistence: `wiki_staleness_run_state` table with cursor tracking — extend for PR-based cursors
- Fire-and-forget side effects for non-critical operations
- Fail-open philosophy: individual failures logged but don't block the scan

### Integration Points
- `wiki-staleness-detector.ts` line 73-118: `fetchChangedFiles()` is the main replacement target — swap commit fetching for PR fetching
- `wiki-staleness-detector.ts` line 274-333: `evaluateWithLlm()` — enhance prompt with actual diff content instead of just file names
- Phase 123 will consume the stored diff evidence via SQL queries on the new PR evidence table
- `wiki-popularity-scorer.ts`: Popularity scores determine which pages to prioritize for staleness evaluation

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 122-enhanced-staleness*
*Context gathered: 2026-03-04*
