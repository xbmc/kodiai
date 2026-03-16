---
id: T01
parent: S02
milestone: M028
provides:
  - Migration 031 adding published_comment_id BIGINT to wiki_update_suggestions
  - HTML comment marker embedded in formatPageComment() for stable identity
  - upsertWikiPageComment() function replacing postCommentWithRetry in publish loop
  - RetrofitPageAction and RetrofitPreviewResult types in wiki-publisher-types.ts
  - commentAction field on PagePostResult; retrofitPreview and issueNumber on PublishRunOptions
key_files:
  - src/db/migrations/031-wiki-comment-identity.sql
  - src/db/migrations/031-wiki-comment-identity.down.sql
  - src/knowledge/wiki-publisher.ts
  - src/knowledge/wiki-publisher-types.ts
  - src/knowledge/wiki-publisher.test.ts
key_decisions:
  - upsertWikiPageComment returns null on any API error (not throws) so caller can log and continue
  - Scan failure (listComments throws) falls through to createComment rather than aborting
  - Logger type imported from "pino" directly in wiki-publisher.ts (was already in types file)
patterns_established:
  - marker format "<!-- kodiai:wiki-modification:{pageId} -->" as first line of every page comment body
  - upsert pattern (scan up to 10 pages desc, updateComment if found, createComment otherwise) mirrors upsertCIComment from ci-failure.ts
observability_surfaces:
  - logger.debug({ pageId, commentId, action }) on every upsert (update vs create branch)
  - logger.debug({ pageId, issueNumber }) on scan failure and API error
  - published_comment_id persisted per row: SELECT page_id, published_comment_id, published_issue_number FROM wiki_update_suggestions WHERE published_at IS NOT NULL
duration: ~30min
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T01: Migration 031, Comment Marker, and Upsert Contract

**Added `published_comment_id BIGINT` migration, stable HTML identity marker in `formatPageComment()`, and `upsertWikiPageComment()` replacing `postCommentWithRetry` in the live publish loop.**

## What Happened

1. Wrote `src/db/migrations/031-wiki-comment-identity.sql` (ADD COLUMN) and `031-wiki-comment-identity.down.sql` (DROP COLUMN IF EXISTS).
2. Added `<!-- kodiai:wiki-modification:{pageId} -->` as the very first line of `formatPageComment()` output, before the `## Title` heading. This is a hidden HTML comment that GitHub renders invisibly but is scannable via API.
3. Added `upsertWikiPageComment()` exported function following the `upsertCIComment` pattern from `src/handlers/ci-failure.ts`: scans up to 10 pages of comments (desc) for the marker, calls `updateComment` on match, `createComment` otherwise. Scan failures fall through to create. API errors return `null`.
4. Updated `wiki-publisher-types.ts`: added `commentAction?: 'updated' | 'created'` to `PagePostResult`, added `retrofitPreview?: boolean` and `issueNumber?: number` to `PublishRunOptions`, added `RetrofitPageAction` and `RetrofitPreviewResult` types.
5. Updated the live publish loop in `createWikiPublisher.publish()` to call `upsertWikiPageComment` instead of `postCommentWithRetry`, and updated the DB mark-published step to write `published_comment_id = ${result.commentId}`.
6. Added `Logger` import from `"pino"` to `wiki-publisher.ts`.
7. Added `upsertWikiPageComment` to the test file imports and added 5 new tests (4 required + 1 scan-throw fallthrough bonus).
8. Updated `createMockOctokit()` in the test file to include `listComments` and `updateComment` mocks (needed since publish loop now calls `upsertWikiPageComment` which calls `listComments`).
9. Applied the S02-PLAN.md pre-flight fix: added failure-state diagnostics block to the Verification section documenting how to inspect per-check failure details with `jq`.

## Verification

```
bun test src/knowledge/wiki-publisher.test.ts
# → 34 pass, 0 fail (29 existing + 5 new)

bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types'
# → (no output) — zero errors on target files
```

## Diagnostics

- `SELECT page_id, published_comment_id, published_issue_number FROM wiki_update_suggestions WHERE published_at IS NOT NULL` — non-null `published_comment_id` confirms upsert path used
- `logger.debug({ pageId, commentId, action })` emitted on every upsert outcome
- `logger.debug({ pageId, issueNumber }, "Failed to scan...")` on scan error
- `logger.debug({ pageId, issueNumber }, "Failed to post wiki comment...")` on API error

## Deviations

- Added a fifth test (`falls through to createComment when scan throws`) beyond the four required — covers the scan-failure fallthrough path explicitly. This is a bonus test, not a deviation from the plan.
- `createMockOctokit()` in the test file needed `listComments` and `updateComment` added (existing tests would have broken otherwise). This is an expected consequence of replacing `postCommentWithRetry` with `upsertWikiPageComment` in the publish loop.

## Known Issues

None. Migration 030 (referenced in S02-PLAN as "prior migration") does not yet exist — the slice plan mentions it as upstream dependency from S01. Migration 031 sequences cleanly after 029 which is the current last migration.

## Files Created/Modified

- `src/db/migrations/031-wiki-comment-identity.sql` — new migration adding published_comment_id BIGINT
- `src/db/migrations/031-wiki-comment-identity.down.sql` — new rollback dropping the column
- `src/knowledge/wiki-publisher.ts` — marker in formatPageComment, new upsertWikiPageComment, updated publish loop and DB write
- `src/knowledge/wiki-publisher-types.ts` — commentAction on PagePostResult; retrofitPreview/issueNumber on PublishRunOptions; RetrofitPageAction and RetrofitPreviewResult types
- `src/knowledge/wiki-publisher.test.ts` — import upsertWikiPageComment; listComments/updateComment in createMockOctokit; 5 new test cases
- `.gsd/milestones/M028/slices/S02/S02-PLAN.md` — failure-state diagnostics block added to Verification section (pre-flight fix)
