# Phase 106: Historical Corpus Population - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Backfill xbmc/xbmc issues (excluding PRs) with Voyage AI embeddings into the issue corpus, including comment threads. Establish nightly sync via GitHub Actions to keep the corpus current. Duplicate detection, auto-triage, and retrieval integration are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Comment embedding strategy
- One vector per comment (not concatenated into issue body)
- Each comment embedding is prefixed with parent issue context: "Issue #N: [title]" so the vector captures what the comment is about
- Bot-generated comments (e.g., [bot] suffix, CI status, stale bot) are filtered out — not embedded
- Long comments are chunked into multiple vectors with overlap, not truncated

### Backfill invocation & UX
- Standalone TypeScript script in scripts/ (e.g., scripts/backfill-issues.ts), not a CLI subcommand
- Accepts --repo owner/name parameter with xbmc/xbmc as default — allows testing on smaller repos
- Progress output uses structured log lines (JSON-style): page count, issues processed, embeddings created, rate limit remaining
- Cursor/resume state stored in the database (sync_state table or metadata row), not a local file

### Nightly sync trigger
- GitHub Action on cron schedule triggers the sync
- Same script as backfill, invoked with --sync flag for incremental mode
- Sync uses stored last-sync timestamp — fetches issues with updated_at > last_sync, no fixed lookback window
- Never deletes from corpus — deleted GitHub issues are kept for historical value

### Error & rate limit handling
- On GitHub rate limit: sleep until x-ratelimit-reset, then auto-resume — backfill completes unattended
- On Voyage AI embedding failure: log the failed issue number, skip it, continue — one bad issue doesn't block the rest
- Uses GitHub App installation token (kodiai's existing credentials) for higher rate limits
- Prints summary report at end: total issues, comments embedded, failures skipped, duration, API calls used

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 106-historical-corpus-population*
*Context gathered: 2026-02-26*
