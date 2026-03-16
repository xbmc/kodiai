---
estimated_steps: 7
estimated_files: 5
---

# T01: Migration 031, Comment Marker, and Upsert Contract

**Slice:** S02 — Deterministic Retrofit & Comment Identity Surface
**Milestone:** M028

## Description

Add the `published_comment_id BIGINT` column to `wiki_update_suggestions` (migration 031), embed a stable hidden HTML marker in `formatPageComment()` so every per-page comment body has a deterministic identity anchor, and replace the create-only `postCommentWithRetry` call in the live publish loop with a new `upsertWikiPageComment()` function that scans for the marker and updates or creates accordingly. The DB mark-published step is updated to write `published_comment_id`.

## Steps

1. Write `src/db/migrations/031-wiki-comment-identity.sql`:
   ```sql
   -- Add published_comment_id for durable wiki comment identity (S02).
   -- BIGINT required — GitHub comment IDs exceed 32-bit int range.
   ALTER TABLE wiki_update_suggestions
     ADD COLUMN published_comment_id BIGINT;
   ```
   Write `src/db/migrations/031-wiki-comment-identity.down.sql`:
   ```sql
   ALTER TABLE wiki_update_suggestions DROP COLUMN IF EXISTS published_comment_id;
   ```

2. In `src/knowledge/wiki-publisher.ts`, edit `formatPageComment()` to prepend the hidden marker as the **very first line** of the output string, before the `## Title` heading:
   ```
   <!-- kodiai:wiki-modification:{pageId} -->
   ```
   The resulting string starts with the marker, then a blank line, then `## pageTitle`. Existing checks (`not.toContain("**Why:**")`, `not.toContain(":warning:")`) are unaffected — they test different substrings.

3. Add `upsertWikiPageComment()` to `src/knowledge/wiki-publisher.ts` (new exported function, after `postCommentWithRetry`). Pattern follows `upsertCIComment` from `src/handlers/ci-failure.ts` lines 263–335:
   ```typescript
   export async function upsertWikiPageComment(
     octokit: Octokit,
     owner: string,
     repo: string,
     issueNumber: number,
     pageId: number,
     body: string,
     logger: Logger,
   ): Promise<{ commentId: number; action: 'updated' | 'created' } | null>
   ```
   - Scan loop: up to 10 pages of `listComments({ per_page: 100, sort: "created", direction: "desc" })`. For each page, check if any `comment.body?.includes(`<!-- kodiai:wiki-modification:${pageId} -->`)`. Stop on match or when `comments.length < 100`.
   - Wrap scan in try/catch — on failure, log debug and fall through to create.
   - If match found: call `octokit.rest.issues.updateComment({ owner, repo, comment_id: existingId, body })`, return `{ commentId: existingId, action: 'updated' }`.
   - If no match: call `octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body })`, return `{ commentId: response.data.id, action: 'created' }`.
   - On any API error: log debug and return null.

4. In `src/knowledge/wiki-publisher-types.ts`:
   - Add `commentAction?: 'updated' | 'created'` to `PagePostResult`
   - Add `retrofitPreview?: boolean` to `PublishRunOptions`
   - Add `issueNumber?: number` to `PublishRunOptions`
   - Add new types:
     ```typescript
     export type RetrofitPageAction = {
       pageId: number;
       pageTitle: string;
       action: 'update' | 'create' | 'no-op';
       existingCommentId: number | null;
     };
     export type RetrofitPreviewResult = {
       actions: RetrofitPageAction[];
       issueNumber: number;
     };
     ```

5. In the live publish loop in `src/knowledge/wiki-publisher.ts` (the `for` loop over `groups`):
   - Replace the `postCommentWithRetry(...)` call with `upsertWikiPageComment(octokit!, owner, repo, issueNumber, group.pageId, commentBody, logger)`.
   - Update the DB mark-published step:
     ```sql
     UPDATE wiki_update_suggestions
     SET published_at = NOW(),
         published_issue_number = ${issueNumber},
         published_comment_id = ${result.commentId}
     WHERE page_id = ${group.pageId}
       AND published_at IS NULL
       AND grounding_status IN ('grounded', 'partially-grounded')
     ```
   - Update the `PagePostResult` push to include `commentAction: result.action`.

6. Add `Logger` import to `wiki-publisher.ts` if not already present (pino `Logger` type from `"pino"`).

7. Add tests to `src/knowledge/wiki-publisher.test.ts`:
   - **Marker test**: Call `formatPageComment({ pageId: 42, ... }, "xbmc", "xbmc")`. Assert `output.startsWith("<!-- kodiai:wiki-modification:42 -->")`.
   - **Upsert update test**: Create mock Octokit where `listComments` returns `[{ id: 5001, body: "<!-- kodiai:wiki-modification:42 --> ..." }]`. Call `upsertWikiPageComment(mockOctokit, "xbmc", "xbmc", 100, 42, "new body", mockLogger)`. Assert `updateComment` was called once with `{ comment_id: 5001 }` and `createComment` was not called. Assert return is `{ commentId: 5001, action: 'updated' }`.
   - **Upsert create test**: Create mock Octokit where `listComments` returns `[]` and `createComment` returns `{ data: { id: 9999 } }`. Call `upsertWikiPageComment(...)`. Assert `createComment` was called and `updateComment` was not. Assert return is `{ commentId: 9999, action: 'created' }`.
   - **Marker does not break S01 guards**: Assert the marker-prefixed output still passes `not.toContain("**Why:**")` and `not.toContain(":warning:")`.

## Must-Haves

- [ ] `src/db/migrations/031-wiki-comment-identity.sql` exists and adds `published_comment_id BIGINT`
- [ ] `src/db/migrations/031-wiki-comment-identity.down.sql` exists and drops the column
- [ ] `formatPageComment()` output starts with `<!-- kodiai:wiki-modification:{pageId} -->`
- [ ] `upsertWikiPageComment()` calls `updateComment` when marker found, `createComment` when not
- [ ] Live publish loop uses `upsertWikiPageComment` and writes `published_comment_id` to DB
- [ ] `RetrofitPageAction` and `RetrofitPreviewResult` types exist in `wiki-publisher-types.ts`
- [ ] All existing + new publisher tests pass
- [ ] TypeScript clean on `wiki-publisher.ts` and `wiki-publisher-types.ts`

## Verification

- `bun test src/knowledge/wiki-publisher.test.ts` — all tests pass (29 existing + 4 new)
- `bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types'` → no output

## Observability Impact

- Signals added/changed: `upsertWikiPageComment` logs `debug` for scan failures and for update vs create outcomes; `published_comment_id` persisted in DB per published row
- How a future agent inspects this: `SELECT page_id, published_comment_id, published_issue_number FROM wiki_update_suggestions WHERE published_at IS NOT NULL` — non-null `published_comment_id` means upsert path was used
- Failure state exposed: null return from `upsertWikiPageComment` means both scan and create failed; caller logs and records error in `PagePostResult`

## Inputs

- `src/knowledge/wiki-publisher.ts` — `formatPageComment`, `postCommentWithRetry`, live publish loop, `delay` helper
- `src/knowledge/wiki-publisher-types.ts` — `PublishRunOptions`, `PageSuggestionGroup`, `PagePostResult`
- `src/knowledge/wiki-publisher.test.ts` — 29 existing tests (must not regress)
- `src/handlers/ci-failure.ts` lines 263–335 — `upsertCIComment` pattern to follow
- `src/db/migrations/030-wiki-modification-artifacts.sql` — prior migration to sequence after

## Expected Output

- `src/db/migrations/031-wiki-comment-identity.sql` — new migration file
- `src/db/migrations/031-wiki-comment-identity.down.sql` — new rollback file
- `src/knowledge/wiki-publisher.ts` — marker in `formatPageComment`, new `upsertWikiPageComment`, updated publish loop
- `src/knowledge/wiki-publisher-types.ts` — extended types including new `RetrofitPageAction` and `RetrofitPreviewResult`
- `src/knowledge/wiki-publisher.test.ts` — 4 new tests added; all 33 pass
