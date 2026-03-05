# Phase 124: Publishing - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Post wiki update suggestions as structured comments on a tracking issue in xbmc/wiki. Each run creates one GitHub issue with a batch summary and per-page comments. Rate-limit safety is required for all GitHub API calls. Generating suggestions is Phase 123; this phase only publishes what's already in the DB.

</domain>

<decisions>
## Implementation Decisions

### Comment Structure
- Show suggestion only (no before/after diff) — the `suggestion` and `why_summary` fields from `wiki_update_suggestions`
- PR citations as inline links within the why_summary text, e.g. "Updated in xbmc/xbmc#12345 (PR title)"
- Voice mismatch warnings shown visibly when `voice_mismatch_warning` is true — add a note like "⚠️ Voice mismatch" so wiki editors review tone carefully
- Section organization within a page comment: Claude's Discretion (grouped under headings vs flat list)

### Tracking Issue Design
- Title format: date-stamped, e.g. "Wiki Update Suggestions — 2026-03-05"
- One new issue per run (no reuse of existing issues)
- Issue body: markdown summary table with columns: Page | Wiki Link | Sections Updated | PRs Cited | Voice Warnings | Comment Link
- Comment links use anchor links — post all comments first, then update issue body with anchors pointing to each comment
- Wiki page URLs included so maintainers can open the actual page alongside the suggestion
- Labels: "wiki-update" + "bot-generated" applied to the tracking issue
- Skipped pages (failed to post) appear in the table with a "skipped" note and no comment link

### Failure & Partial Run Handling
- On comment post failure: skip that page and continue posting remaining pages; log the failure
- Report all skipped pages in the final summary (both console output and issue table)
- Add `published_at` and `published_issue_number` columns to `wiki_update_suggestions` — mark rows as published after successful comment post
- Re-running the script skips already-published suggestions (idempotent)
- Rate-limit backoff strategy: Claude's Discretion (implement GitHub secondary rate-limit best practices — Retry-After header, exponential backoff, minimum delay between comments)

### CLI Invocation Model
- Script name: `scripts/publish-wiki-updates.ts` (follows existing `scripts/generate-wiki-updates.ts` pattern)
- `--dry-run` prints formatted markdown to stdout; `--dry-run --output file.md` writes to file
- Progress logging per page during live run: "Posted: Add-on_development (3 sections, 2 PRs cited)" plus final summary
- `--page-ids 123,456` to publish specific pages only
- `--grounded-only` flag to skip suggestions with voice mismatch warnings
- Config/env vars: Claude's Discretion (likely reuse existing AppConfig for GitHub App credentials, add --owner/--repo flags for testing flexibility)

### Claude's Discretion
- Section organization within page comments (grouped H3 headings vs flat blocks)
- Rate-limit implementation details (exact delays, retry counts, backoff curve)
- Config/env var approach for target repo
- Exact markdown formatting choices for comments

</decisions>

<specifics>
## Specific Ideas

- Summary table should link to both the wiki page (external URL) and the comment within the issue (anchor link) — two different links per row
- The issue body is updated AFTER all comments are posted so anchor links resolve correctly
- Use `published_at`/`published_issue_number` in DB for idempotency — this is a schema migration

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/auth/github-app.ts`: `createGitHubApp` with `getInstallationOctokit()` and `getRepoInstallationContext()` — handles GitHub App auth, installation token management
- `src/knowledge/wiki-update-types.ts`: `UpdateSuggestion` type with all fields needed for comment formatting (pageTitle, sectionHeading, suggestion, whySummary, citingPrs, voiceMismatchWarning)
- `scripts/generate-wiki-updates.ts`: CLI script pattern — parseArgs, pino logger, DB client setup, cost tracker — direct template for the new script

### Established Patterns
- CLI scripts use `parseArgs` from `node:util` with pino logger
- DB access via `createDbClient()` from `src/db/client.ts`
- GitHub API via `@octokit/rest` with `@octokit/auth-app` for GitHub App authentication
- Migrations in `src/db/migrations/` with sequential numbering

### Integration Points
- Reads from `wiki_update_suggestions` table (populated by Phase 123)
- Needs new migration to add `published_at`/`published_issue_number` columns to `wiki_update_suggestions`
- Uses `getRepoInstallationContext("xbmc", "wiki")` to verify installation and get authenticated Octokit
- Octokit `issues.create()` and `issues.createComment()` for GitHub API calls

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 124-publishing*
*Context gathered: 2026-03-05*
