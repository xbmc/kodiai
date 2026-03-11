# T03: 89-pr-review-comment-ingestion 03

**Slice:** S01 — **Milestone:** M018

## Description

Implement incremental sync of PR review comments via webhook handlers for create, edit, and delete events.

Purpose: Keep the review comment corpus up-to-date in real-time as new reviews happen, without requiring manual backfill re-runs.
Output: Webhook handler module registered on the event router, with background embedding via job queue.

## Must-Haves

- [ ] "New review comments on any PR are ingested via webhook on pull_request_review_comment.created"
- [ ] "Edited comments are re-embedded via pull_request_review_comment.edited webhook"
- [ ] "Deleted comments are soft-deleted via pull_request_review_comment.deleted webhook"
- [ ] "Webhook handler acknowledges immediately and processes embedding in background via job queue"
- [ ] "Bot comments are filtered and not ingested"
- [ ] "No auto re-review behavior is introduced (explicit user policy)"

## Files

- `src/handlers/review-comment-sync.ts`
- `src/handlers/review-comment-sync.test.ts`
- `src/index.ts`
