---
id: S05
parent: M025
milestone: M025
provides:
  - CLI entry point scripts/publish-wiki-updates.ts for publishing wiki update suggestions
  - Wiki publisher module (createWikiPublisher) for posting suggestions to GitHub issues
  - Migration 024 adding published_at/published_issue_number columns for idempotency
  - Publisher types (WikiPublisherOptions, PublishResult, PageSuggestionGroup, etc.)
  - Comprehensive unit tests (25 tests, 55 assertions)
requires: []
affects: []
key_files: []
key_decisions:
  - "Dry-run creates stub GitHubApp instead of requiring credentials — no GitHub env vars needed for preview"
  - "Reuses loadPrivateKey logic inline (PEM string, file path, or base64 detection) rather than importing from config.ts to avoid requiring all AppConfig env vars"
  - "Minimal AppConfig with placeholder values for non-GitHub fields since publisher only uses githubAppId and githubPrivateKey"
  - "Exported formatPageComment, formatSummaryTable, postCommentWithRetry as named exports for testability"
  - "Rate limit backoff: 60s base with power-of-2 multiplier (60s, 120s, 240s) on 403 without Retry-After"
  - "Dry-run path skips pre-flight check entirely (no GitHub App needed for preview)"
  - "URL-encodes wiki page titles with space-to-underscore replacement for kodi.wiki URL format"
patterns_established:
  - "Publishing CLI pattern: dry-run stub for GitHubApp when credentials not needed"
  - "Rate-limited GitHub API pattern: postCommentWithRetry with Retry-After header support"
  - "Idempotent publishing: published_at/published_issue_number columns prevent duplicate posts"
observability_surfaces: []
drill_down_paths: []
duration: 8min
verification_result: passed
completed_at: 2026-03-05
blocker_discovered: false
---
# S05: Publishing

**# Phase 124: Publishing — Plan 02 Summary**

## What Happened

# Phase 124: Publishing — Plan 02 Summary

**CLI script for publishing wiki update suggestions with dry-run preview and flexible targeting flags**

## Performance

- **Duration:** 3 min
- **Tasks:** 1
- **Files created:** 1

## Accomplishments
- scripts/publish-wiki-updates.ts following exact generate-wiki-updates.ts pattern
- All CLI flags: --dry-run, --output, --page-ids, --grounded-only, --owner, --repo, --comment-delay
- Dry-run mode works without GitHub credentials (stub GitHubApp)
- Summary banner with issue link, page counts, and skip reports
- Delegates all publishing logic to createWikiPublisher (zero duplication)

## Task Commits

1. **Task 1: Create publish-wiki-updates.ts** - `55d0b855a8` (feat)

## Files Created/Modified
- `scripts/publish-wiki-updates.ts` - CLI entry point for publishing wiki update suggestions

## Decisions Made
- Dry-run creates a stub GitHubApp to avoid requiring GITHUB_APP_ID/GITHUB_PRIVATE_KEY for preview-only runs
- Private key loading logic duplicated inline rather than importing loadConfig() (avoids requiring all Slack env vars)

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - uses existing GITHUB_APP_ID and GITHUB_PRIVATE_KEY environment variables.

## Next Phase Readiness
- Publishing pipeline complete end-to-end
- Ready for verification

---
*Phase: 124-publishing*
*Completed: 2026-03-05*

# Phase 124: Publishing — Plan 01 Summary

**Wiki publisher module with rate-limited comment posting, pre-flight installation check, and idempotent DB tracking**

## Performance

- **Duration:** 8 min
- **Tasks:** 4
- **Files created:** 5

## Accomplishments
- Migration 024 adds published_at and published_issue_number columns with partial index
- Publisher module with pre-flight GitHub App installation verification (PUB-04)
- Rate-limited comment posting with 3s minimum delay and exponential backoff on 403 (PUB-03)
- Issue creation with date-stamped title and wiki-update/bot-generated labels (PUB-01)
- Per-page comments with section suggestions, PR citations, voice mismatch warnings (PUB-02)
- Summary table with anchor links to comments, updated after all comments posted
- 25 unit tests covering all requirements with 55 assertions

## Task Commits

1. **Task 1: Create DB migration** - `37bc5b3b0d` (feat)
2. **Task 2: Create publisher types** - `334e71694a` (feat)
3. **Task 3: Create wiki publisher module** - `c44e698b52` (feat)
4. **Task 4: Create publisher unit tests** - `fb21d6c0c0` (test)

## Files Created/Modified
- `src/db/migrations/024-wiki-update-publishing.sql` - ALTER TABLE adding publishing columns
- `src/db/migrations/024-wiki-update-publishing.down.sql` - Rollback migration
- `src/knowledge/wiki-publisher-types.ts` - Type definitions for publisher pipeline
- `src/knowledge/wiki-publisher.ts` - Core publisher module with createWikiPublisher factory
- `src/knowledge/wiki-publisher.test.ts` - 25 unit tests across 7 test groups

## Decisions Made
- Exported helper functions (formatPageComment, formatSummaryTable, postCommentWithRetry) for direct unit testing
- Dry-run mode skips pre-flight entirely since no GitHub API calls are made
- Wiki page URLs use underscore for spaces (kodi.wiki convention)
- Rate limit backoff uses 60s base with doubling (60s, 120s, 240s)

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Publisher module ready for CLI script integration (Plan 02)
- All types exported, tested, and committed

---
*Phase: 124-publishing*
*Completed: 2026-03-05*
