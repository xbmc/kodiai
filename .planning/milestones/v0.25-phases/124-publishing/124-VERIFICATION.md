---
phase: 124
slug: publishing
status: passed
verified: 2026-03-05
---

# Phase 124: Publishing — Verification

## Phase Goal
Update suggestions are posted as structured comments on a tracking issue in xbmc/wiki with rate-limit safety

## Requirement Verification

| Requirement | Status | Evidence |
|-------------|--------|----------|
| PUB-01: Tracking issue created in xbmc/wiki with batch summary | PASS | `wiki-publisher.ts` lines 289-299: `issues.create()` with date-stamped title and labels; lines 381-393: `issues.update()` with summary table containing anchor links |
| PUB-02: Per-page update suggestions posted as individual comments | PASS | `wiki-publisher.ts` lines 300-376: loop over page groups, `postCommentWithRetry()` per page; `formatPageComment()` includes sections, PR citations, voice warnings |
| PUB-03: Rate-limit-aware posting with minimum delays | PASS | `wiki-publisher.ts` line 181: `commentDelayMs = 3000` default; line 378: `delay(commentDelayMs)` between comments; `postCommentWithRetry()` lines 119-166: 403 detection with Retry-After header and exponential backoff (60s, 120s, 240s) |
| PUB-04: GitHub App installation verified before publishing | PASS | `wiki-publisher.ts` lines 197-213: `getRepoInstallationContext(owner, repo)` pre-flight check; returns empty result with actionable error if null |

## Must-Haves Verification

| Must-Have | Status | Evidence |
|-----------|--------|----------|
| Migration 024 adds published_at and published_issue_number | PASS | `024-wiki-update-publishing.sql` exists with ALTER TABLE adding both columns |
| Pre-flight check returns gracefully when app not installed | PASS | Code returns `emptyResult` (no throw); test "returns empty result when app not installed" passes |
| Issue with date-stamped title and labels | PASS | Title: `Wiki Update Suggestions — ${today}`; labels: `["wiki-update", "bot-generated"]` |
| One comment per page with sections, PRs, voice warnings | PASS | `formatPageComment()` groups all sections per page; PR links as `[#N](url)`; voice warning as blockquote |
| 3-second minimum delay between comments | PASS | Default `commentDelayMs = 3000`; applied between every comment |
| Exponential backoff on 403 | PASS | `postCommentWithRetry()` with Retry-After header support and 60s/120s/240s fallback |
| Skip failed pages, continue remaining | PASS | On null result from `postCommentWithRetry()`, page added to `skippedPages` and loop continues |
| Summary table with anchor links after all comments | PASS | `formatSummaryTable()` builds table; `issues.update()` called after all comments posted |
| Published_at/published_issue_number marked in DB | PASS | UPDATE query sets both columns after successful comment post |
| Re-running skips already-published suggestions | PASS | WHERE clause includes `published_at IS NULL` |

## Test Results

- 25 unit tests passing
- 55 assertions
- Coverage: pre-flight, issue creation, comment posting, rate limiting, summary table, idempotency, dry-run

## Success Criteria Check

| Criterion | Status |
|-----------|--------|
| A tracking issue is created in xbmc/wiki with a batch summary of all pages evaluated | PASS |
| Each page's update suggestions are posted as an individual comment on the tracking issue | PASS |
| Comment posting respects GitHub secondary rate limits with minimum delays and backoff on 403 responses | PASS |
| GitHub App installation on xbmc/wiki is verified before any publishing attempt | PASS |

## Artifacts

| File | Purpose |
|------|---------|
| src/db/migrations/024-wiki-update-publishing.sql | Migration adding publishing columns |
| src/db/migrations/024-wiki-update-publishing.down.sql | Rollback migration |
| src/knowledge/wiki-publisher-types.ts | Type definitions |
| src/knowledge/wiki-publisher.ts | Core publisher module |
| src/knowledge/wiki-publisher.test.ts | 25 unit tests |
| scripts/publish-wiki-updates.ts | CLI entry point |

## Verdict

**PASSED** — All 4 requirements verified, all must-haves confirmed, 25 tests passing.
