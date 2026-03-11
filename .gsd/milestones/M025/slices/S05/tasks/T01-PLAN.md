# T01: 124-publishing 01

**Slice:** S05 — **Milestone:** M025

## Description

Create the wiki publisher module that posts update suggestions as structured comments on a GitHub tracking issue.

Purpose: Core publishing logic — pre-flight check, issue creation, comment formatting, rate-limited posting, summary table with anchor links, DB idempotency marking.
Output: `src/knowledge/wiki-publisher.ts` module, types, migration, and unit tests.

## Must-Haves

- [ ] wiki_update_suggestions table has published_at and published_issue_number columns added via migration 024
- [ ] Publisher module verifies GitHub App installation on xbmc/wiki before any API calls (pre-flight check)
- [ ] Pre-flight check returns null gracefully with actionable error when app not installed
- [ ] Publisher creates a tracking issue with date-stamped title and wiki-update + bot-generated labels
- [ ] Publisher posts one comment per page with section suggestions, PR citations, and voice mismatch warnings
- [ ] Minimum 3-second delay between createComment API calls
- [ ] On 403 response, publisher retries with exponential backoff using Retry-After header
- [ ] On comment failure, publisher skips that page and continues remaining pages
- [ ] After all comments posted, publisher updates issue body with summary table containing anchor links
- [ ] Published suggestions are marked with published_at and published_issue_number in DB
- [ ] Re-running publisher skips already-published suggestions (idempotent)

## Files

- `src/db/migrations/024-wiki-update-publishing.sql`
- `src/db/migrations/024-wiki-update-publishing.down.sql`
- `src/knowledge/wiki-publisher.ts`
- `src/knowledge/wiki-publisher-types.ts`
- `src/knowledge/wiki-publisher.test.ts`
