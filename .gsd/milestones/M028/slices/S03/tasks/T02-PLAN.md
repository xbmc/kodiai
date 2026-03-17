---
estimated_steps: 5
estimated_files: 1
---

# T02: Run Live Publish to xbmc/wiki Issue #5

**Slice:** S03 — Live Modification-Only Wiki Publishing
**Milestone:** M028

## Description

This is the operational execution task. T01 wired `--issue-number` to the live publish path. T02 actually uses it against `xbmc/wiki` issue #5 — the real `Wiki Update Suggestions — 2026-03-12` thread that currently holds 8 suggestion-style comments.

**Expected behavior:**
- The publisher calls `issues.get` (not `issues.create`) — no new issue spawned.
- For grounded/partially-grounded unpublished pages, the publisher calls `upsertWikiPageComment` on issue #5.
- Since the 8 existing comments have no `<!-- kodiai:wiki-modification:{pageId} -->` marker, `upsertWikiPageComment` will call `createComment` (not `updateComment`) — new modification-only comments are created alongside the old suggestion-style ones. This is expected and correct for S03; the new comments are the canonical modification artifacts.
- `published_comment_id` is written to the DB with real GitHub comment IDs (integers > 0 and > 100, not sentinel 0).

**Scoping strategy (important):**
There are 83 unpublished rows. A full run would flood issue #5 with up to 83 new comments. Instead:
1. Dry-run first to inspect modification-only output and confirm zero `**Why:**` occurrences.
2. Scoped live run: pick 3–5 page IDs from the unpublished pool and publish only those first to verify the mechanism.
3. If scoped run succeeds (DB shows real `published_comment_id` > 0, no new issue created), optionally expand — but DO NOT run a full 83-comment flood. A scoped run is sufficient to prove the S03 contract.

**Prerequisites:** T01 must be complete. The environment needs `GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY` (or `GITHUB_PRIVATE_KEY_BASE64`) set. The xbmc/wiki GitHub App installation must be active.

## Steps

1. **Dry-run check**: run the publisher in dry-run mode to confirm modification-only output:
   ```bash
   bun scripts/publish-wiki-updates.ts --dry-run --output /tmp/wiki-s03-dry.md
   grep -c '\*\*Why:\*\*' /tmp/wiki-s03-dry.md
   # Must return 0
   grep -c 'kodiai:wiki-modification' /tmp/wiki-s03-dry.md
   # Must return > 0 (markers present in output)
   ```
   If `grep -c '**Why:**'` returns > 0, **stop** — there is a regression in S01's `formatPageComment`. Do not proceed to live publish until that is resolved.

2. **Identify scope for first live run**: query the DB for a small set of grounded pages:
   ```sql
   SELECT DISTINCT page_id, page_title FROM wiki_update_suggestions
   WHERE published_at IS NULL
     AND grounding_status IN ('grounded', 'partially-grounded')
   LIMIT 3;
   ```
   Note the 3 `page_id` values (they are integers). These will be the `--page-ids` argument.

3. **Scoped live run**: publish 3 pages to issue #5:
   ```bash
   bun scripts/publish-wiki-updates.ts --issue-number 5 --page-ids <id1,id2,id3>
   ```
   Observe the output:
   - Should say `"Using supplied tracking issue #5"` (not "Created tracking issue")
   - Should show pages posted and comment IDs
   - Should NOT show any new issue number ≠ 5

4. **DB verification**: confirm real comment IDs were written:
   ```sql
   SELECT page_id, published_comment_id, published_issue_number, published_at
   FROM wiki_update_suggestions
   WHERE published_at IS NOT NULL
     AND published_comment_id > 0
   ORDER BY published_at DESC
   LIMIT 5;
   ```
   Expected: at least 3 rows, `published_comment_id` values are large integers (GitHub comment IDs, typically 8–10 digits), `published_issue_number = 5`.

5. **Sentinel row check (informational)**: note how many sentinel rows remain:
   ```sql
   SELECT COUNT(*) FROM wiki_update_suggestions
   WHERE published_at IS NOT NULL AND published_comment_id = 0;
   ```
   This is expected to still be 21 (the legacy rows backfilled in S02). That's fine — S03 does not re-publish legacy rows; it only proves new publishes get real IDs.

## Must-Haves

- [ ] Dry-run output contains zero occurrences of `**Why:**` — proof that modification-only contract is active
- [ ] Live run posts to issue #5 (not a newly created issue) — `published_issue_number = 5` in DB
- [ ] At least one row in `wiki_update_suggestions` has `published_comment_id > 0` (real GitHub comment ID, not sentinel)
- [ ] No new xbmc/wiki issue was created during the run (issue count on xbmc/wiki does not increase)

## Verification

```bash
# After step 1:
grep -c '\*\*Why:\*\*' /tmp/wiki-s03-dry.md
# → 0

# After step 3–4:
# DB query (adapt as needed for your Postgres client):
psql $DATABASE_URL -c "
  SELECT page_id, published_comment_id, published_issue_number
  FROM wiki_update_suggestions
  WHERE published_at IS NOT NULL AND published_comment_id > 0
  ORDER BY published_at DESC LIMIT 5;
"
# → at least 3 rows; published_issue_number = 5; published_comment_id > 100000000
```

## Observability Impact

- Signals added: `logger.info({ issueNumber, issueUrl }, "Using supplied tracking issue #N")` (from T01); `logger.info({ pageTitle, sections, prs }, "Posted: {title}")` per published page
- How a future agent inspects this: `SELECT published_comment_id FROM wiki_update_suggestions WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 5` — non-zero values confirm live publish worked; `bun run verify:m028:s03 --json` after T03 is complete
- Failure state exposed: if the GitHub App is not installed on xbmc/wiki, the publisher logs an error and returns the empty result; `pagesPosted = 0` in the output signals failure

## Inputs

- `scripts/publish-wiki-updates.ts` — T01 must be complete (live issue-number wiring in place)
- DB state: 83+ unpublished grounded rows in `wiki_update_suggestions`
- Environment: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` (or `GITHUB_PRIVATE_KEY_BASE64`) set; xbmc/wiki GitHub App installation active
- xbmc/wiki issue #5 — the existing `Wiki Update Suggestions — 2026-03-12` tracking issue

## Expected Output

- DB rows for 3 published pages: `published_comment_id > 0`, `published_issue_number = 5`, `published_at` is recent
- xbmc/wiki issue #5 has new modification-only comments (with `<!-- kodiai:wiki-modification:{pageId} -->` marker, no `**Why:**`)
- No new tracking issue created on xbmc/wiki during this run
