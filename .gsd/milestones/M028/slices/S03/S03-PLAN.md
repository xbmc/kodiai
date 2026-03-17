# S03: Live Modification-Only Wiki Publishing

**Milestone:** M028
**Goal:** The real `xbmc/wiki` tracking issue flow publishes modification-only comments for new wiki updates, and the publisher can target an existing issue instead of always creating a new one, so historical suggestion-style comments are replaced by fresh modification-only content through the same live publisher path.

**Demo:** `bun scripts/publish-wiki-updates.ts --issue-number 5` posts modification-only comments to xbmc/wiki issue #5. After the run, `published_comment_id` rows in the DB hold real (non-zero) GitHub comment IDs, and the comments themselves contain the `<!-- kodiai:wiki-modification:{pageId} -->` marker with no `**Why:**` text.

## Must-Haves

- `--issue-number <n>` works for live publish (not just `--retrofit-preview`), so the publisher targets an existing tracking issue instead of always creating a new one.
- The publisher skips `issues.create` when `issueNumber` is supplied in `PublishRunOptions`.
- A live publish run against xbmc/wiki issue #5 produces at least one comment with the modification-only format and a non-zero `published_comment_id` in the DB.
- `scripts/verify-m028-s03.ts` with 4 check IDs passes all pure-code checks and at least the `LIVE-MARKER` DB check after the live publish run.

## Proof Level

- This slice proves: integration + operational
- Real runtime required: yes (live GitHub publish, real DB writes)
- Human/UAT required: no (machine-checkable via verifier and DB queries)

## Verification

```bash
# 1. Publisher test suite (no regressions from T01 wiring changes)
bun test src/knowledge/wiki-publisher.test.ts
# → 37 pass, 0 fail

# 2. Dry-run confirms no **Why:** in output before live run
bun scripts/publish-wiki-updates.ts --dry-run --output /tmp/wiki-s03-dry.md
grep -c '**Why:**' /tmp/wiki-s03-dry.md
# → 0

# 3. Live publish to existing issue
bun scripts/publish-wiki-updates.ts --issue-number 5
# → posts modification-only comments to xbmc/wiki issue #5
# → no new issue created

# 4. DB confirms real comment IDs written
# → at least one row WHERE published_comment_id > 0 AND published_at > (start of run)

# 5. Verifier
bun run verify:m028:s03 --json
# → overallPassed: true
# M028-S03-NO-WHY-IN-RENDER: pass (pure-code)
# M028-S03-LIVE-MARKER: pass (DB-gated)
# M028-S03-COMMENT-BODY: pass OR skipped if GitHub scan not available
# M028-S03-SENTINEL-CLEARED: informational (reports progress, not pass/fail)

# 6. Verifier test suite
bun test ./scripts/verify-m028-s03.test.ts
# → all pass

# 7. TypeScript — zero errors on S03 target files
bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types|verify-m028-s03|publish-wiki'
# → (no output)
```

## Observability / Diagnostics

- Runtime signals: `logger.info({ issueNumber, issueUrl })` when using supplied issue number; `logger.info({ commentId, action })` per upsert; `logger.warn` when `--issue-number` is given without app credentials
- Inspection surfaces: `bun run verify:m028:s03 --json`; DB query `SELECT page_id, published_comment_id, published_issue_number FROM wiki_update_suggestions WHERE published_at > NOW() - INTERVAL '1 hour' ORDER BY published_at DESC`
- Failure visibility: `M028-S03-LIVE-MARKER` check fails when no rows have `published_comment_id > 0`; `M028-S03-COMMENT-BODY` check fails when comments contain `**Why:**`; `SENTINEL-CLEARED` reports count of remaining sentinel rows (informational, not a hard failure)
- Redaction constraints: none (comment IDs and issue numbers are public)

## Integration Closure

- Upstream surfaces consumed: S01 `formatPageComment()` (modification-only render); S02 `upsertWikiPageComment()`, identity marker, `published_comment_id` column
- New wiring introduced in this slice: `--issue-number` flag wired to live publish path in `scripts/publish-wiki-updates.ts` + corresponding `issueNumber` bypass of `issues.create` in `wiki-publisher.ts`
- What remains before the milestone is truly usable end-to-end: S04 final integrated acceptance + regression guards

## Tasks

- [ ] **T01: Wire `--issue-number` to live publish path** `est:45m`
  - Why: Currently `--issue-number` is only parsed inside the `if (retrofitPreview)` block in `scripts/publish-wiki-updates.ts`, and `publish()` always calls `issues.create` on live runs. To post to an existing issue, we need: (a) parse `--issue-number` unconditionally, (b) pass it to `publisher.publish()` even without `--retrofit-preview`, and (c) have `publish()` skip `issues.create` and use the supplied `issueNumber` directly when provided.
  - Files: `scripts/publish-wiki-updates.ts`, `src/knowledge/wiki-publisher.ts`, `src/knowledge/wiki-publisher-types.ts`, `src/knowledge/wiki-publisher.test.ts`
  - Do: Move `--issue-number` parsing outside the `if (retrofitPreview)` block so it applies to all runs. Pass `issueNumber` from the parsed CLI value to `publisher.publish({ ..., issueNumber: liveIssueNumber })`. In `wiki-publisher.ts` publish(), just before step 5 (`issues.create`), add: if `runOptions.issueNumber` is provided and `!retrofitPreview`, assign `issueNumber = runOptions.issueNumber` and fetch `issueUrl` via `octokit.rest.issues.get(...)` instead of creating. Also update the tracking-issue title — rename from `Wiki Update Suggestions` to `Wiki Modification Artifacts` in the title of newly created issues. Update `PublishRunOptions` comment: `issueNumber` now applies to both retrofitPreview AND live publish. Add a publisher test covering the supplied-issue-number path. In `scripts/publish-wiki-updates.ts`, update the `--issue-number` help text and the printed summary to show "Issue: #N (supplied)" vs "Issue: #N (created)".
  - Verify: `bun test src/knowledge/wiki-publisher.test.ts` → 38+ pass, 0 fail; `bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|publish-wiki'` → no output
  - Done when: Publisher tests pass including a new test that confirms `issues.create` is NOT called and `issues.get` IS called when `issueNumber` is supplied; zero TS errors on touched files

- [ ] **T02: Run live publish to xbmc/wiki issue #5** `est:30m`
  - Why: S03's core claim — that the live `xbmc/wiki` tracking issue flow publishes modification-only comments — requires actually running the live publish against issue #5. This task does the operational execution: dry-run first to inspect output, then live run, then DB verification.
  - Files: `scripts/publish-wiki-updates.ts` (run only, no edits), DB (read results)
  - Do: (1) Run dry-run: `bun scripts/publish-wiki-updates.ts --dry-run --output /tmp/wiki-s03-dry.md` and confirm `grep -c '**Why:**' /tmp/wiki-s03-dry.md` returns 0. (2) Scope the first live run to a small set of page IDs to verify the mechanism before posting all pages. Use the first available grounded page ID (query DB: `SELECT DISTINCT page_id FROM wiki_update_suggestions WHERE published_at IS NULL AND grounding_status IN ('grounded','partially-grounded') LIMIT 3`), then run `bun scripts/publish-wiki-updates.ts --issue-number 5 --page-ids <id1,id2,id3>`. (3) Confirm that `published_comment_id > 0` for the posted pages via DB query. (4) Confirm that `issues.create` was NOT called (no new issue was created — issue #5 still exists and no issue #6 or later appeared). (5) If scoped run succeeds, optionally run the full publish for all grounded pages with `--issue-number 5` (skip if there are too many unpublished rows that would flood issue #5). Record the final DB state.
  - Verify: DB query `SELECT page_id, published_comment_id, published_issue_number FROM wiki_update_suggestions WHERE published_at IS NOT NULL AND published_comment_id > 0 ORDER BY published_at DESC LIMIT 5` returns at least one row; `published_issue_number = 5` for those rows
  - Done when: At least one row has `published_comment_id > 0` and `published_issue_number = 5` in the DB; no new tracking issue was created during the run

- [ ] **T03: S03 proof harness** `est:60m`
  - Why: S03 needs a machine-checkable verifier that locks the live-publish contract the same way S01 and S02 proof harnesses locked their contracts. The harness must cover both pure-code checks (always runnable) and DB/GitHub-gated checks (report `db_unavailable` or `github_unavailable` gracefully when not wired).
  - Files: `scripts/verify-m028-s03.ts` (new), `scripts/verify-m028-s03.test.ts` (new), `package.json`
  - Do: Model the harness after `verify-m028-s02.ts`. Export `M028_S03_CHECK_IDS`, `evaluateM028S03(sql?, octokit?, owner?, repo?, issueNumber?)`, and `buildM028S03ProofHarness(opts?)`. Implement four checks:
    - `M028-S03-NO-WHY-IN-RENDER` (pure-code, always runs): call `formatPageComment()` with a mock group and assert the result does NOT contain `"**Why:**"` and NOT contain `":warning:"`. Mirror the S01 check but as S03's own contract lock.
    - `M028-S03-LIVE-MARKER` (DB-gated): query `SELECT COUNT(*) FROM wiki_update_suggestions WHERE published_at IS NOT NULL AND published_comment_id > 0`. Pass when count > 0 (at least one real published comment ID). Skip with `db_unavailable` when DB absent/unreachable. Fail with `no_real_ids` when count = 0.
    - `M028-S03-COMMENT-BODY` (GitHub-gated): when `octokit`, `owner`, `repo`, and `issueNumber` are provided, scan the issue comments for the `<!-- kodiai:wiki-modification:{pageId} -->` marker. Pass when at least one comment has the marker AND does NOT contain `"**Why:**"`. Skip with `github_unavailable` when args are absent.
    - `M028-S03-SENTINEL-CLEARED` (DB-gated, informational): query `SELECT COUNT(*) FROM wiki_update_suggestions WHERE published_at IS NOT NULL AND published_comment_id = 0` (sentinel rows). Always pass — report count as `detail`. Purpose: operator visibility into migration completeness, not a hard gate.
    Write `verify-m028-s03.test.ts` with tests for: check ID list, envelope shape, `NO-WHY-IN-RENDER` pass/fail, `LIVE-MARKER` pass/skip/fail with DB stubs, `SENTINEL-CLEARED` always-pass behavior, `overallPassed` logic (true when all non-skipped checks pass). Add `"verify:m028:s03": "bun scripts/verify-m028-s03.ts"` to `package.json`.
  - Verify: `bun test ./scripts/verify-m028-s03.test.ts` → all pass; `bun run verify:m028:s03 --json` → `overallPassed: true`; `bunx tsc --noEmit 2>&1 | grep verify-m028-s03` → no output
  - Done when: Test suite passes, verifier exits 0 with `overallPassed: true` in this environment (DB connected, T02 run complete), zero TS errors on new files

## Files Likely Touched

- `scripts/publish-wiki-updates.ts` — move `--issue-number` parsing outside `retrofitPreview` gate
- `src/knowledge/wiki-publisher.ts` — skip `issues.create` when `issueNumber` supplied; update new-issue title
- `src/knowledge/wiki-publisher-types.ts` — update `issueNumber` comment (applies to live publish too)
- `src/knowledge/wiki-publisher.test.ts` — add supplied-issue-number test
- `scripts/verify-m028-s03.ts` — new: 4-check proof harness
- `scripts/verify-m028-s03.test.ts` — new: tests
- `package.json` — add `verify:m028:s03` alias
