---
id: S03
parent: M028
milestone: M028
uat_type: integration + operational (artifact-driven + live-runtime)
---

# S03: Live Modification-Only Wiki Publishing — UAT

**Milestone:** M028
**Written:** 2026-03-16

## UAT Type

- UAT mode: integration + operational (artifact-driven + live-runtime)
- Why this mode is sufficient: S03's claims are fully machine-checkable — live GitHub comment IDs in the DB prove the publish happened, `bun run verify:m028:s03 --json` locks the render contract, and publisher tests guard against regressions. No human readability judgment is required.

## Preconditions

1. `DATABASE_URL` points to a live Postgres instance with `wiki_update_suggestions` rows (grounded pages available).
2. GitHub App credentials are configured (required for live publish; not required for dry-run or verifier checks).
3. xbmc/wiki issue #5 exists and is open.
4. `bun install` completed; TypeScript compiles with no errors on S03 target files.
5. T02 live publish has already run — at least 3 pages have `published_comment_id > 0` and `published_issue_number = 5` in DB.

## Smoke Test

```bash
bun run verify:m028:s03 --json
```

Expected: `"overallPassed": true` with `NO-WHY-IN-RENDER: passed`, `LIVE-MARKER: passed` (count ≥ 1), `SENTINEL-CLEARED: passed`. If this passes, the S03 contract is intact.

---

## Test Cases

### 1. `--issue-number` flag wired to live publish (not just retrofitPreview)

**Purpose:** Confirm the flag applies to all run modes, not just `--retrofit-preview`.

1. Run: `bun scripts/publish-wiki-updates.ts --help | grep -A2 "issue-number"`
2. **Expected:** Help text says `"Target issue number for live publish or --retrofit-preview"` — no mention of "requires --retrofit-preview".
3. Run: `LOG_LEVEL=debug bun scripts/publish-wiki-updates.ts --dry-run --issue-number 5 2>&1 | head -20`
4. **Expected:** No error about `--issue-number` requiring `--retrofit-preview`. Dry-run proceeds normally.

---

### 2. Publisher skips `issues.create` when `--issue-number` is supplied

**Purpose:** Confirm the publisher fetches the existing issue rather than creating a new one.

1. Run: `LOG_LEVEL=debug bun scripts/publish-wiki-updates.ts --issue-number 5 --dry-run 2>&1 | grep -E "supplied|create|Using supplied"`
2. **Expected:** Contains `"Using supplied tracking issue"` or similar log. Does NOT contain `"Creating tracking issue"`.
3. Verify no new issue was created on xbmc/wiki (issue count remains the same; issue #5 is the last one or no issue with number > last pre-S03 issue exists).

---

### 3. Dry-run output contains zero `**Why:**` occurrences

**Purpose:** Confirm `formatPageComment` no longer emits rationale prose.

1. Run: `bun scripts/publish-wiki-updates.ts --dry-run --output /tmp/wiki-s03-uat.md`
2. Run: `grep -c '**Why:**' /tmp/wiki-s03-uat.md`
3. **Expected:** `0`
4. Run: `grep -c 'kodiai:wiki-modification' /tmp/wiki-s03-uat.md`
5. **Expected:** ≥ 1 (modification markers present in output)

---

### 4. Live publish writes real GitHub comment IDs to DB

**Purpose:** Confirm the already-executed T02 live publish has left real (non-zero) comment IDs in the DB.

1. Query: `SELECT page_id, published_comment_id, published_issue_number FROM wiki_update_suggestions WHERE published_at IS NOT NULL AND published_comment_id > 0 ORDER BY published_at DESC LIMIT 5;`
2. **Expected:** At least 3 rows with:
   - `published_comment_id > 100000000` (10-digit GitHub integer)
   - `published_issue_number = 5`
3. Query: `SELECT COUNT(*) FROM wiki_update_suggestions WHERE published_at IS NOT NULL AND published_comment_id = 0;`
4. **Expected:** 21 (sentinel rows from pre-identity-tracking publish; informational)

---

### 5. Publisher test suite passes with no regressions

**Purpose:** Confirm T01 wiring changes did not break existing publisher behavior and new test covers supplied-issueNumber path.

1. Run: `bun test src/knowledge/wiki-publisher.test.ts`
2. **Expected:** 38 pass, 0 fail
3. Confirm the test output includes `"supplied issueNumber — live publish to existing issue"` in the test name list.

---

### 6. Proof harness exits `overallPassed: true`

**Purpose:** Lock the S03 contract machine-readably.

1. Run: `bun run verify:m028:s03 --json`
2. **Expected:**
   ```json
   {
     "overallPassed": true,
     "checks": [
       { "id": "M028-S03-NO-WHY-IN-RENDER", "passed": true, "skipped": false },
       { "id": "M028-S03-LIVE-MARKER", "passed": true, "skipped": false },
       { "id": "M028-S03-COMMENT-BODY", "skipped": true },
       { "id": "M028-S03-SENTINEL-CLEARED", "passed": true, "skipped": false }
     ]
   }
   ```
3. `COMMENT-BODY` skipped is expected in CLI env without Octokit credentials — this is not a failure.

---

### 7. Verifier test suite passes

**Purpose:** Confirm the proof harness itself is correct.

1. Run: `bun test ./scripts/verify-m028-s03.test.ts`
2. **Expected:** 33 pass, 0 fail

---

### 8. Zero TypeScript errors on S03 target files

**Purpose:** Confirm no type regressions from S03 changes.

1. Run: `bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types|verify-m028-s03|publish-wiki'`
2. **Expected:** No output (zero errors on touched files)

---

## Edge Cases

### Edge Case 1: Bad `--issue-number` triggers observable error, not unhandled rejection

1. Run: `bun scripts/publish-wiki-updates.ts --issue-number 999999 2>&1`
2. **Expected:** Prints `"Wiki update publishing failed"` with error detail (likely 404 from GitHub) and exits 1. Does NOT throw an unhandled exception with no context.

### Edge Case 2: `--issue-number` without GitHub credentials logs a warning, not a crash

1. Temporarily unset GitHub App credentials (or run in an env where they are absent).
2. Run: `LOG_LEVEL=debug bun scripts/publish-wiki-updates.ts --issue-number 5 --dry-run 2>&1 | head -20`
3. **Expected:** Either proceeds (dry-run doesn't need credentials) or logs a warning and exits cleanly. Does NOT crash with an unhandled exception.

### Edge Case 3: Re-running publish on already-published pages is idempotent

1. Query the 3 already-published page IDs: `SELECT page_id FROM wiki_update_suggestions WHERE published_comment_id > 0 LIMIT 3`
2. Run a second publish: `bun scripts/publish-wiki-updates.ts --issue-number 5 --page-ids <id1,id2,id3>`
3. **Expected:** Publisher performs update (upsert) rather than creating duplicate comments. Comment IDs remain the same or updated comment body replaces old content. No duplicate comments created on issue #5.

### Edge Case 4: `verify:m028:s03` without DB returns partial results, not crash

1. Run with no DATABASE_URL (or invalid URL): `DATABASE_URL=invalid bun run verify:m028:s03 --json`
2. **Expected:** JSON output with `LIVE-MARKER: { skipped: true, status_code: "db_unavailable" }` and `NO-WHY-IN-RENDER: passed`. Does NOT crash. `overallPassed` may be false (LIVE-MARKER skipped means no proof of live publish), but the command exits without an exception.

---

## Failure Signals

- `grep -c '**Why:**' /tmp/wiki-s03-uat.md` returns > 0 → `formatPageComment` regression; recheck `wiki-publisher.ts` for rationale prose.
- `published_comment_id = 0` for recent rows → sentinel row written; publisher used old stub path instead of real GitHub upsert.
- `bun run verify:m028:s03 --json` → `LIVE-MARKER: { passed: false, status_code: "no_real_ids" }` → live publish has not written real comment IDs; T02 live run did not complete or DB is wrong.
- `bun test src/knowledge/wiki-publisher.test.ts` → failures on "supplied issueNumber" test → T01 wiring regressed.
- `issues.create` called during `--issue-number 5` run → branching logic in `wiki-publisher.ts` publish() not working; check step 5 branch.
- New issue created on xbmc/wiki (issue number > 5 appeared) → `issues.create` was called despite `--issue-number` flag.

---

## Requirements Proved By This UAT

- **R026** — Published wiki comments contain only modification content plus minimal metadata. Proved by: dry-run `**Why:**` count = 0, live comment IDs in DB, modification marker in dry-run output, `NO-WHY-IN-RENDER` check passed.
- **R028** — Existing published wiki suggestion comments can be retrofitted or superseded. Proved by: publisher targets existing issue #5 (not creating a new one), enabling the same flow to post over previously-suggestion-style content in that thread.
- **R029** — Regression checks prevent opinion-style wiki publishing from returning. Proved by: `M028-S03-NO-WHY-IN-RENDER` and full-body `wiki-publisher.test.ts` guards together form a dual-layer regression fence.

## Not Proven By This UAT

- **R025** (wiki outputs are modification-only) — S01 primary; S03 provides supporting evidence but full proof lives in S01's verifier.
- **R027** (hybrid granularity) — S01 primary; S03 exercises the section/page pipeline but granularity mode-selection proof is in S01.
- **COMMENT-BODY live scan** — Requires Octokit credentials in the verifier CLI. The check works in tests but skips in the default CLI env. S04 should confirm this check passes with live credentials.
- **Full publish of all 80+ remaining grounded pages** — T02 scoped to 3 pages. A full run with `--issue-number 5` (no `--page-ids` scope) was not executed in S03.
- **Sentinel row cleanup** — 21 rows with `published_comment_id = 0` remain. They are historically correct but represent a gap in comment-identity tracking. S04 can address if needed.

## Notes for Tester

- The 3 pages published to xbmc/wiki issue #5 in T02 are: `page_id = 213` (Advancedsettings.xml), `page_id = 259` (Artwork), `page_id = 287` (Userdata). These comments can be inspected at https://github.com/xbmc/wiki/issues/5.
- `COMMENT-BODY` check skipping is expected and not a failure signal — it requires live Octokit credentials. All other checks pass without GitHub access.
- The 21 sentinel rows are expected and informational. They came from S02 backfill of rows published before identity tracking. `SENTINEL-CLEARED` reports their count as `sentinel_rows=21` — this is a visibility feature, not a problem to fix before S04.
- TypeScript has ~47 pre-existing errors from M027 work in embedding/repair scripts. These are out of S03 scope. The `bunx tsc` check in this UAT intentionally scopes to S03 files only via `grep`.
