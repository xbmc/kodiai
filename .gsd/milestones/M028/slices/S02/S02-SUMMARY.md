---
id: S02
parent: M028
milestone: M028
provides:
  - Migration 031 adding published_comment_id BIGINT to wiki_update_suggestions
  - HTML identity marker "<!-- kodiai:wiki-modification:{pageId} -->" as first line of every formatPageComment() output
  - upsertWikiPageComment() replacing postCommentWithRetry in the live publish loop (scan-update-or-create contract)
  - retrofitPreview branch in publish() — reads GitHub, returns RetrofitPreviewResult, never mutates
  - --retrofit-preview / --issue-number CLI flags in scripts/publish-wiki-updates.ts
  - RetrofitPageAction, RetrofitPreviewResult types; commentAction on PagePostResult; retrofitPreview/issueNumber on PublishRunOptions; retrofitPreviewResult on PublishResult
  - 4-check proof harness scripts/verify-m028-s02.ts with evaluateM028S02 / buildM028S02ProofHarness exports
  - 34-test suite scripts/verify-m028-s02.test.ts; verify:m028:s02 package.json alias
  - Legacy row backfill: 21 pre-existing published rows given published_comment_id=0 sentinel
requires:
  - slice: S01
    provides: formatPageComment(), PageSuggestionGroup.modificationMode, modification artifact contract, dry-run render shape
affects:
  - S03
  - S04
key_files:
  - src/db/migrations/031-wiki-comment-identity.sql
  - src/db/migrations/031-wiki-comment-identity.down.sql
  - src/knowledge/wiki-publisher.ts
  - src/knowledge/wiki-publisher-types.ts
  - src/knowledge/wiki-publisher.test.ts
  - scripts/publish-wiki-updates.ts
  - scripts/verify-m028-s02.ts
  - scripts/verify-m028-s02.test.ts
  - package.json
key_decisions:
  - upsertWikiPageComment returns null on any API error (not throws) so caller can log and continue
  - Scan failure (listComments throws) falls through to createComment rather than aborting
  - Marker is HTML comment — hidden in rendered GitHub view, scannable via API
  - retrofitPreview branch re-uses the pre-flight octokit (avoids double auth); requires dryRun=false
  - Legacy rows backfilled with published_comment_id=0 sentinel (0 is never a real GitHub comment ID)
  - evaluateM028S02 runs all 4 checks in parallel via Promise.all; no ordering dependency
patterns_established:
  - Marker format "<!-- kodiai:wiki-modification:{pageId} -->" as first line of every page comment body
  - Upsert pattern (scan up to 10 pages desc, per_page=100, updateComment if found, createComment otherwise) mirrors upsertCIComment from ci-failure.ts
  - Retrofit-preview reads GitHub but never writes — same pagination loop as upsert, zero mutation methods
  - 4-check proof harness: 2 pure-code (always run) + 2 DB-gated (skip gracefully with db_unavailable)
  - Sequential sql stub helper for verifier tests needing different DB responses per check
  - Sentinel value 0 for "published before comment identity tracking" — distinguishable from both NULL (gap) and real IDs (>0)
observability_surfaces:
  - bun run verify:m028:s02 --json — structured JSON report; .checks[].status_code discriminates marker_present / upsert_contract_ok / schema_ok / no_linkage_gap
  - bun run verify:m028:s02 --json 2>&1 | jq '.checks[] | select(.passed == false)' — failing checks with .detail
  - bun run verify:m028:s02 --json 2>&1 | jq '.checks[] | select(.skipped == true)' — DB skip (non-failure) vs DB failure
  - logger.debug({ pageId, commentId, action }) on every upsert outcome
  - logger.info({ pageId, pageTitle, action, existingCommentId }) per planned action from retrofit-preview path
  - SELECT page_id, published_comment_id, published_issue_number FROM wiki_update_suggestions WHERE published_at IS NOT NULL
  - CLI prints: "Retrofit Preview — Issue #N" + ACTION|PAGE|COMMENT ID|WIKI URL table
drill_down_paths:
  - .gsd/milestones/M028/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M028/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M028/slices/S02/tasks/T03-SUMMARY.md
duration: ~110min (T01: ~30min, T02: ~35min, T03: ~45min)
verification_result: passed
completed_at: 2026-03-16
---

# S02: Deterministic Retrofit & Comment Identity Surface

**Stable HTML identity markers, upsert-based comment publishing, and a safe retrofit-preview path give operators deterministic control over which live GitHub comments represent wiki modification artifacts.**

## What Happened

S02 delivered the foundational identity infrastructure that lets the publisher deterministically find, update, or preview existing wiki modification comments on a GitHub tracking issue — without manual thread inspection.

**T01** laid the foundation: migration 031 adds `published_comment_id BIGINT` to `wiki_update_suggestions`, providing per-row durable linkage between a DB artifact and its live GitHub comment. `formatPageComment()` was updated to embed `<!-- kodiai:wiki-modification:{pageId} -->` as the very first line of every comment body — an HTML comment GitHub renders invisibly but exposes fully via the comments API. `upsertWikiPageComment()` replaced `postCommentWithRetry` in the live publish loop: it scans up to 10 pages of issue comments (desc, per_page=100) for the marker, calls `updateComment` on match, `createComment` otherwise, and persists `published_comment_id` back to the DB. This mirrors the `upsertCIComment` pattern from `ci-failure.ts` and closes the duplicate-comment problem permanently.

**T02** added the operator-facing preview surface: the `retrofitPreview` branch inside `publish()` reads GitHub exactly like the upsert scan but never calls `createComment` or `updateComment`. It returns `RetrofitPreviewResult` with per-page `action: 'update' | 'create'` and `existingCommentId`. The CLI gained `--retrofit-preview` and `--issue-number` flags that print a formatted action table to stdout. Missing `--issue-number` with `--retrofit-preview` exits with a diagnostic error message. The publisher also throws if called programmatically without `issueNumber`.

**T03** wrote the proof harness: `scripts/verify-m028-s02.ts` with four machine-checkable checks — `M028-S02-COMMENT-MARKER` (pure-code: marker in first line), `M028-S02-UPSERT-CONTRACT` (pure-code: both update and create mock paths pass), `M028-S02-COMMENT-ID-SCHEMA` (DB-gated: column present), and `M028-S02-PUBLISHED-LINKAGE` (DB-gated: no published rows missing comment ID). All four pass in the target environment. The 34-test suite covers check IDs, envelope shape, DB-skip behavior, and overallPassed semantics. A real DB discovery during T03: 21 legacy published rows (published before migration 031) had NULL `published_comment_id` and needed a sentinel backfill (value=0) to satisfy `PUBLISHED-LINKAGE`.

## Verification

```
bun test src/knowledge/wiki-publisher.test.ts
# → 37 pass, 0 fail

bun test ./scripts/verify-m028-s02.test.ts
# → 34 pass, 0 fail

bun run verify:m028:s02 --json
# → overallPassed: true, exit 0
# checks: marker_present / upsert_contract_ok / schema_ok / no_linkage_gap

bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types|verify-m028-s02|publish-wiki'
# → (no output) — zero errors on all S02 target files

bun scripts/publish-wiki-updates.ts --help | grep retrofit-preview
# → --retrofit-preview    Scan issue for existing wiki comments, preview planned actions
```

## Requirements Advanced

- **R028** — Existing published wiki suggestion comments can be retrofitted or superseded: upsert contract, identity markers, and retrofit-preview path are now in place. Live supersession (actual GitHub writes) is wired in S03.

## Requirements Validated

None newly validated by S02 alone — R028 reaches validated status upon S03 live execution.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

- **Fifth upsert test:** T01 added a scan-throw fallthrough test beyond the four required. Bonus coverage, no plan impact.
- **Mock expansion:** `createMockOctokit()` in `wiki-publisher.test.ts` needed `listComments` and `updateComment` added since the publish loop now calls `upsertWikiPageComment`. Expected consequence of replacing `postCommentWithRetry`.
- **Legacy row backfill in T03:** 21 pre-existing published rows had NULL `published_comment_id` (published before migration 031). Backfilled with sentinel value 0 to satisfy `PUBLISHED-LINKAGE`. The plan did not anticipate this; the fix is correct and observable (sentinel 0 is never a real GitHub comment ID).
- **34 tests instead of 20:** Extra DB-with-stub coverage added in T03 (schema_ok, column_missing, no_linkage_gap, linkage_gap_found paths). Exceeds the minimum.

## Known Limitations

- **Live supersession not yet wired:** `upsertWikiPageComment` is the correct implementation, but S03 is the first slice that exercises it against the real `xbmc/wiki` tracking issue with an active GitHub App session. S02 proves the contract with mocks only.
- **Retrofit-preview requires GitHub App credentials:** `--retrofit-preview` reads live GitHub comments and will fail without `GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY` in the environment. Not a gap — intentional (the flag is for operators with credentials, not dry-run CI).
- **Sentinel backfill is permanent:** Legacy rows show `published_comment_id=0`. The `PUBLISHED-LINKAGE` check treats these as non-gaps. S03 operators may want to re-publish these pages through the upsert path to get real comment IDs; that is a S03 concern.

## Follow-ups

- S03 should exercise `upsertWikiPageComment` against the live `xbmc/wiki` issue and confirm `published_comment_id` is set to real GitHub comment IDs post-publish.
- S03 should also confirm `--retrofit-preview` output is accurate against a real issue thread before running live mutations.
- Consider a separate operational script (or verifier check) to report rows with `published_comment_id=0` vs real IDs, to track migration completeness after S03 live runs.

## Files Created/Modified

- `src/db/migrations/031-wiki-comment-identity.sql` — new: `ALTER TABLE wiki_update_suggestions ADD COLUMN published_comment_id BIGINT`
- `src/db/migrations/031-wiki-comment-identity.down.sql` — new: `ALTER TABLE wiki_update_suggestions DROP COLUMN IF EXISTS published_comment_id`
- `src/knowledge/wiki-publisher.ts` — identity marker in formatPageComment; new upsertWikiPageComment; retrofitPreview branch; updated publish loop + DB write
- `src/knowledge/wiki-publisher-types.ts` — commentAction on PagePostResult; retrofitPreview/issueNumber on PublishRunOptions; RetrofitPageAction, RetrofitPreviewResult types; retrofitPreviewResult on PublishResult
- `src/knowledge/wiki-publisher.test.ts` — listComments/updateComment mocks; 8 new tests (5 upsert + 3 retrofitPreview); 37 total
- `scripts/publish-wiki-updates.ts` — --retrofit-preview and --issue-number flags; action table printer; real GitHub App setup when retrofitPreview active
- `scripts/verify-m028-s02.ts` — new: 4-check proof harness with evaluateM028S02, buildM028S02ProofHarness, M028_S02_CHECK_IDS exports
- `scripts/verify-m028-s02.test.ts` — new: 34 tests across 7 groups
- `package.json` — added `"verify:m028:s02": "bun scripts/verify-m028-s02.ts"`

## Forward Intelligence

### What the next slice should know
- The marker `<!-- kodiai:wiki-modification:{pageId} -->` is on the **first line** of every comment. Scan logic must check `comment.body?.startsWith(marker)` (or `includes` within the first ~60 chars). The current implementation uses `includes` in a window — confirm this is sufficient against real GitHub API response bodies that may have CRLF line endings.
- `published_comment_id=0` is the sentinel for "published before identity tracking." S03 should treat 0 as "unknown, re-publish to get real ID" rather than "linked." Consider a `WHERE published_comment_id > 0` guard in any logic that assumes a real live comment ID.
- The `retrofitPreview` branch requires `dryRun=false` (or equivalently: a real Octokit). When building S03 live publish flows, if you want to preview before live-posting, call `retrofitPreview` first (separate publish invocation), then run the full publish. They share the same scan logic.
- Migration 031 is the only DB schema dependency in S02. If the migration hasn't run in a target environment, `COMMENT-ID-SCHEMA` will report `column_missing` and both DB-gated checks will fail.

### What's fragile
- **`createMockOctokit()` in `wiki-publisher.test.ts`** now includes `listComments` and `updateComment` in the base mock. Any future test that constructs a minimal mock without these will silently fail the upsert path — tests will still pass but the mock shape will diverge. Keep the base mock in sync with the publisher's API surface.
- **Retrofit-preview error handling:** If `issueNumber` is valid but the GitHub API returns a 404 or pagination error, the current implementation logs debug and returns an empty result. This is silent — S03 should add a diagnostic surface for failed scans during retrofit-preview so operators know when the issue number is wrong.
- **Backfill sentinel (0):** The `PUBLISHED-LINKAGE` check passes because 0 is treated as non-NULL. If new published rows somehow get written with `published_comment_id=0` from a bug (not the backfill), they would also pass the check. A stricter check (`published_comment_id > 0 OR published_comment_id IS NULL`) would catch this; deferred for now.

### Authoritative diagnostics
- `bun run verify:m028:s02 --json` — the primary readiness signal; all four checks passing means both the code contract and DB schema are correct
- `SELECT page_id, published_comment_id, published_issue_number FROM wiki_update_suggestions WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 20` — confirms upsert path is writing comment IDs (non-zero after live S03 runs)
- `bun test src/knowledge/wiki-publisher.test.ts` — the 37-test suite is the fastest signal for upsert/marker/retrofit-preview regressions

### What assumptions changed
- **Migration 031 applied separately from plan order:** T01 wrote the migration files; T03 actually applied them (and discovered the legacy row gap). In future slices, verify migration application during the task that writes it, not the task that uses it.
- **Sentinel backfill not anticipated:** The plan assumed either zero published rows or all published rows would have been written by the new upsert path. Reality: 21 legacy rows needed a one-time backfill. Document this in operational runbooks for any environment where migration 031 is applied to an existing database.
