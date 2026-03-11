# Phase 124: Publishing - Research

**Researched:** 2026-03-05
**Status:** Complete

## Phase Objective

Post wiki update suggestions as structured comments on a tracking issue in xbmc/wiki. Create one GitHub issue per run with a batch summary table, then post per-page comments with section-level rewrite suggestions. Rate-limit safety for all GitHub API calls. Mark published rows in DB for idempotency.

## Existing Infrastructure

### GitHub App Auth (Fully Reusable)
- `src/auth/github-app.ts`: `createGitHubApp()` returns a `GitHubApp` interface
- `getRepoInstallationContext(owner, repo)` resolves installation ID + default branch; returns `null` if app not installed (404 handling built in)
- `getInstallationOctokit(installationId)` returns authenticated Octokit client
- Pre-flight check: call `getRepoInstallationContext("xbmc", "wiki")` — if null, fail gracefully with actionable error message

### Data Source: wiki_update_suggestions Table
- Migration 023: `wiki_update_suggestions` with columns: id, page_id, page_title, section_heading, original_content, suggestion, why_summary, grounding_status, citing_prs (JSONB), voice_mismatch_warning, voice_scores, generated_at, created_at
- `citing_prs` is JSONB array of `{prNumber, prTitle}` objects
- `grounding_status` is `'grounded' | 'ungrounded' | 'no_update'`
- No `published_at` or `published_issue_number` columns exist yet — need migration 024

### CLI Script Pattern (from generate-wiki-updates.ts)
- `parseArgs` from `node:util` with typed options
- `pino` logger with `LOG_LEVEL` env var
- `createDbClient({ logger })` + `runMigrations(db.sql)`
- Summary banner at end with stats
- `main().then(() => process.exit(0)).catch(...)` pattern

### Config (from src/config.ts)
- `AppConfig` has `githubAppId`, `githubPrivateKey` — needed for GitHub App auth
- `wikiGithubOwner` defaults to `"xbmc"`, `wikiGithubRepo` defaults to `"xbmc"` (this is for the CODE repo, not the wiki repo)
- For the wiki repo target (xbmc/wiki), the script should accept `--owner`/`--repo` flags with defaults

## Technical Decisions

### Migration 024: Publishing Columns
Add to `wiki_update_suggestions`:
```sql
ALTER TABLE wiki_update_suggestions
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN published_issue_number INTEGER;
```
Both nullable (additive-only constraint). An index on `published_at IS NULL` for efficient "unpublished" queries.

### GitHub API Calls Required
1. **Pre-flight**: `getRepoInstallationContext("xbmc", "wiki")` — verify installation
2. **Create issue**: `octokit.rest.issues.create({ owner, repo, title, body, labels })`
3. **Create comments**: `octokit.rest.issues.createComment({ owner, repo, issue_number, body })` — one per page
4. **Update issue body**: `octokit.rest.issues.update({ owner, repo, issue_number, body })` — after all comments posted, insert anchor links

### Rate Limiting Strategy
- GitHub secondary rate limit: ~80 requests/minute for content creation endpoints
- **Minimum delay**: 3 seconds between `createComment` calls (20 req/min, well under limit)
- **On 403 with `Retry-After` header**: Wait the specified seconds, then retry
- **On 403 without `Retry-After`**: Exponential backoff starting at 60s, max 3 retries
- **On other errors**: Log, mark page as skipped, continue to next page
- Use `setTimeout` promise wrapper for delays

### Comment Structure per Page
```markdown
## {pageTitle}

**Wiki page:** [View on wiki](https://kodi.wiki/view/{pageTitle_urlencoded})

{for each section suggestion:}

### {sectionHeading || "Introduction"}

{suggestion text}

**Why:** {whySummary}
**PRs:** {citingPrs mapped to links: [#{prNumber}](https://github.com/xbmc/xbmc/pull/{prNumber}) ({prTitle})}

{if voiceMismatchWarning:}
> :warning: **Voice mismatch** — review tone and style carefully before applying
{end if}

---
```

### Issue Body (Summary Table)
```markdown
# Wiki Update Suggestions — {date}

**Generated:** {date}
**Pages evaluated:** {total}
**Suggestions posted:** {posted}
**Pages skipped:** {skipped}

| # | Page | Wiki Link | Sections | PRs Cited | Voice Warnings | Comment |
|---|------|-----------|----------|-----------|----------------|---------|
| 1 | {pageTitle} | [View](url) | {count} | {count} | {yes/no} | [View](#issuecomment-{id}) |
| 2 | ... | ... | ... | ... | ... | skipped |
```
The `Comment` column uses GitHub anchor links (`#issuecomment-{id}`) which requires posting comments first, collecting their IDs, then updating the issue body.

### Idempotency
- Query `WHERE published_at IS NULL AND grounding_status = 'grounded'` to find unpublished suggestions
- After successful comment post for a page, UPDATE all that page's suggestions: `SET published_at = NOW(), published_issue_number = {issueNumber}`
- Re-running skips already-published rows
- `--grounded-only` flag (from CONTEXT.md) maps to adding `AND voice_mismatch_warning = false` to the WHERE clause

### Dry Run
- `--dry-run` formats the same markdown but prints to stdout instead of calling GitHub API
- `--dry-run --output file.md` writes to a file
- No DB updates in dry-run mode

## Validation Architecture

### Unit Tests
1. **Comment formatter**: Given an `UpdateSuggestion[]` for a page, verify markdown output matches expected structure (section headings, PR links, voice warnings)
2. **Summary table builder**: Given page results with comment IDs, verify table markdown with anchor links
3. **Rate limiter**: Verify delay between calls, backoff on 403

### Integration Tests
4. **Pre-flight check**: Mock `getRepoInstallationContext` returning null → verify graceful failure
5. **Full publish flow**: Mock Octokit → verify issue created, comments posted in order, issue body updated with anchors, DB rows marked published
6. **Partial failure**: Mock one comment failing → verify that page is skipped, others succeed, summary reflects skipped page
7. **Idempotency**: Run twice → second run publishes zero (all marked published)

### Acceptance Criteria Mapping
- PUB-01 (tracking issue): Integration test #5 — issue created with summary table
- PUB-02 (per-page comments): Integration test #5 — one comment per page
- PUB-03 (rate limiting): Unit test #3 + integration test with timing assertions
- PUB-04 (installation check): Integration test #4 — pre-flight fails gracefully

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| GitHub App not installed on xbmc/wiki | Medium | Pre-flight check with actionable error message |
| Secondary rate limit hit despite delays | Low | 3s delay is conservative; backoff on 403 |
| Large number of pages causes very long issue | Low | Top 20 cap from Phase 123; future: pagination |
| Comment body exceeds GitHub's size limit (65536 chars) | Very Low | Pages typically have 3-5 sections; truncation fallback if needed |

## RESEARCH COMPLETE