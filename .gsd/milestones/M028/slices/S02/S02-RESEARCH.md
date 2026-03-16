# S02: Deterministic Retrofit & Comment Identity Surface — Research

**Date:** 2026-03-16

## Summary

S01 delivered the modification-only artifact contract, mode-first schema (migration 030), and clean publisher rendering. What is still missing is the ability to identify, target, and supersede prior suggestion-style wiki comments in a reproducible way. Today the DB stores `published_issue_number` (migration 024) but not `published_comment_id`, and `formatPageComment()` embeds no stable marker. That means the publisher cannot locate an existing comment to update — it can only create new ones.

S02 is targeted, not exploratory. The patterns needed already exist in this codebase: `upsertCIComment()` in `src/handlers/ci-failure.ts` uses exactly the scan-by-marker → update-or-create flow. The M028-S01 verifier establishes the check-ID/envelope pattern for the proof harness. S02 wires these two together around wiki comment identity.

Primary recommendation: add a stable hidden marker to `formatPageComment()`, a `published_comment_id` column to the DB, an upsert path in the publisher, and a retrofit-preview mode to the publish CLI. Then write a verifier with four check IDs that prove all four of these surfaces work.

## Recommendation

Build in this order:

1. **Migration 031** — `published_comment_id BIGINT` on `wiki_update_suggestions`. Schema dependency; everything downstream is blocked until this exists.
2. **Marker in `formatPageComment()`** — embed `<!-- kodiai:wiki-modification:{pageId} -->` as the first line of every per-page comment body. Pure-code; testable immediately; unblocks upsert and retrofit scanning.
3. **Upsert logic in publisher** — `upsertWikiPageComment()` following the `upsertCIComment` pattern: scan `issues.listComments` for the page marker, call `updateComment` if found, `createComment` otherwise. Persist `published_comment_id` in the DB mark-published step.
4. **Retrofit preview path** — new `retrofitPreview()` branch in `publish()` (guarded by `runOptions.retrofitPreview`). Scans a target issue for known markers, reports per-page planned actions (`update` / `create` / `no-op`) without mutating. Needs a live Octokit — separate from `--dry-run`.
5. **CLI `--retrofit-preview` flag** in `scripts/publish-wiki-updates.ts`.
6. **Verifier** `scripts/verify-m028-s02.ts` + tests + `package.json` alias.

The upsert and retrofit-preview paths require a live GitHub connection, but the marker check and comment-ID schema check can and should be unit/pure-code tested.

## Implementation Landscape

### Key Files

- `src/db/migrations/024-wiki-update-publishing.sql` — current publish tracking; only adds `published_at` and `published_issue_number`. No comment-level linkage.
- `src/db/migrations/030-wiki-modification-artifacts.sql` — adds `modification_mode`, `replacement_content`; unique index is `(page_id, modification_mode, COALESCE(section_heading, ''))`. Migration 031 must follow this.
- `src/knowledge/wiki-publisher.ts` — `formatPageComment()` currently has no marker; `postCommentWithRetry()` only creates; the mark-published `UPDATE` only writes `published_at` and `published_issue_number`. All three need S02 additions.
- `src/knowledge/wiki-publisher-types.ts` — `PageSuggestionGroup` and `PagePostResult` are the primary data shapes. `PublishRunOptions` needs `retrofitPreview?: boolean`. Add `RetrofitPageAction` and `RetrofitPreviewResult` types here.
- `src/knowledge/wiki-publisher.test.ts` — 29 tests, fully rewritten in S01. Add: (a) marker-in-output test, (b) upsert-update-path test with mock `listComments`, (c) retrofit-preview output shape test.
- `src/handlers/ci-failure.ts` + `src/lib/ci-failure-formatter.ts` — `upsertCIComment()` and `buildCIAnalysisMarker()` are the exact patterns to follow. Marker format: `<!-- kodiai:ci-analysis:owner/repo/pr-NUMBER -->`. Wiki marker should be: `<!-- kodiai:wiki-modification:{pageId} -->`.
- `scripts/publish-wiki-updates.ts` — add `--retrofit-preview` boolean flag; call `publisher.publish({ retrofitPreview: true })` and print per-page action plan.
- `scripts/verify-m028-s01.ts` — reference for check-ID/envelope/skip-gracefully/CLI-runner pattern. Copy the structure.
- `package.json` — add `"verify:m028:s02": "bun scripts/verify-m028-s02.ts"`.

### New Files

- `src/db/migrations/031-wiki-comment-identity.sql` — `ALTER TABLE wiki_update_suggestions ADD COLUMN published_comment_id BIGINT;`
- `src/db/migrations/031-wiki-comment-identity.down.sql` — rollback: `ALTER TABLE wiki_update_suggestions DROP COLUMN IF EXISTS published_comment_id;`
- `scripts/verify-m028-s02.ts` — proof harness
- `scripts/verify-m028-s02.test.ts` — 20+ verifier tests

### Build Order

1. **Migration 031** — no other work has a hard runtime dependency on this, but tests that inspect the DB schema gate on it. Write it first so the DB-gated verifier checks can be written alongside the implementation rather than retrofitted.
2. **`formatPageComment()` marker** — zero-risk addition; existing negative tests pass with the marker present (no test asserts marker absence). This is the single change that makes all scan-based upsert/retrofit logic possible.
3. **`upsertWikiPageComment()`** — new function in `wiki-publisher.ts`; replace `postCommentWithRetry` call in the live publish path with this. Update the mark-published DB step to write `published_comment_id`. Test with mock `listComments` returning an existing match and no match.
4. **`retrofitPreview()` path** — add `retrofitPreview` option to `PublishRunOptions`; branch inside `publish()` after Octokit setup to scan the specified issue for wiki markers and return a `RetrofitPreviewResult`. This path does not write to DB or post/edit comments.
5. **CLI `--retrofit-preview`** — parse flag, pass `{ retrofitPreview: true, issueNumber }` to publisher, print planned actions table.
6. **Verifier + tests + package.json** — four check IDs (see Verification Approach).

### Verification Approach

```
# Pure-code verifier checks (always run):
M028-S02-COMMENT-MARKER     — formatPageComment output contains <!-- kodiai:wiki-modification:{pageId} -->
M028-S02-UPSERT-CONTRACT    — upsertWikiPageComment calls updateComment when marker found, createComment otherwise

# DB-gated (skip gracefully when DB absent/unreachable):
M028-S02-COMMENT-ID-SCHEMA  — published_comment_id column exists in wiki_update_suggestions
M028-S02-PUBLISHED-LINKAGE  — rows with published_at set also have published_comment_id non-null (new runs only)

# Commands:
bun run verify:m028:s02 --json
bun test src/knowledge/wiki-publisher.test.ts     # includes new marker + upsert tests
bun test ./scripts/verify-m028-s02.test.ts
bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|verify-m028-s02'
```

For the retrofit-preview path: exercise with `scripts/publish-wiki-updates.ts --retrofit-preview --dry-run --page-ids <id>` and inspect that the output lists planned actions without any GitHub mutation. This can be verified in a unit test with mock Octokit.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Scan-by-marker → update-or-create comment upsert | `upsertCIComment()` in `src/handlers/ci-failure.ts` | Exact pattern needed; already handles pagination, missing comments, and Octokit error handling |
| Stable comment marker format | `buildCIAnalysisMarker()` in `src/lib/ci-failure-formatter.ts` returning `<!-- kodiai:ci-analysis:... -->` | Follow the same invisible HTML comment convention; wiki variant: `<!-- kodiai:wiki-modification:{pageId} -->` |
| Machine-checkable proof harness | `scripts/verify-m028-s01.ts` — check_ids + overallPassed + checks envelope; DB-gated checks skip gracefully | S02 verifier should be a structural clone of S01 verifier |
| Octokit `listComments` + `updateComment` + `createComment` | Already used throughout `src/handlers/`, `src/execution/mention-context.ts`, etc. | Standard — no wrapper needed |

## Constraints

- `published_comment_id` must be `BIGINT` (not `INTEGER`) — GitHub comment IDs exceed 32-bit int range.
- `upsertWikiPageComment()` must scan the issue specified by `published_issue_number` (or a caller-supplied `issueNumber`) — the retrofit-preview path needs an explicit issue number since it is reading an existing issue, not creating one.
- The retrofit-preview mode requires a live Octokit (it reads from GitHub). It is mutually exclusive with `dryRun: true`. Document this: `dryRun` skips all GitHub I/O; `retrofitPreview` reads GitHub but does not write.
- Old rows with `published_at` set and `published_comment_id = null` should be valid retrofit targets — the scan-by-marker fallback handles them.
- `formatPageComment()` is imported by `scripts/verify-m028-s01.ts` — adding the marker to its output must not break the S01 pure-code checks (`no_why_in_render`, `pr_citations_present`). Both checks are substring-based and are unaffected by a leading HTML comment.
- The unique index introduced in migration 030 is on `(page_id, modification_mode, COALESCE(section_heading, ''))`. Migration 031 is purely additive (new column) — no index change needed.
- `PageSuggestionGroup.modificationMode` is already `'section' | 'page'` — the marker format uses only `pageId` (not mode or section) so a single comment per page is the identity unit, consistent with how the publisher groups and posts.

## Common Pitfalls

- **Making `retrofitPreview` a sub-mode of `dryRun`** — they are different: `dryRun` skips all GitHub I/O (safe offline), `retrofitPreview` reads GitHub but does not write. Mixing them will prevent live retrofit scanning from working in dry-run environments.
- **Using `published_issue_number` alone to identify comments** — one issue can have many comments; the marker is required to pick the right one per page. Without the marker, scanning is O(N) over all comments with no termination guarantee.
- **Forgetting that the S01 summary table links use `#issuecomment-{commentId}`** — those links will now point to the updated comment (same ID after `updateComment`), so link stability is preserved by the upsert approach.
- **Scanning only the first page of comments** — use the `upsertCIComment` pagination pattern (loop until `comments.length < 100` or marker found). Old suggestion-style issues may have many comments.
- **Not persisting `published_comment_id` for new runs** — if the DB write omits this column, every future rerun will scan-by-marker and may duplicate comments when `updateComment` is unavailable.

## Open Risks

- The retrofit-preview path needs a real GitHub issue number to scan. If no prior suggestion-style issue exists in the test environment, the preview will always report "create-new" and the preview behavior for the supersession case cannot be exercised without a live fixture.
- The `upsertWikiPageComment()` scan may be slow on large wiki tracking issues with hundreds of comments. A page limit of 10 pages (1000 comments) matches the `upsertCIComment` pattern and should be sufficient.

## Sources

- `upsertCIComment` scan-and-upsert pattern with pagination: `src/handlers/ci-failure.ts` lines 260-340
- `buildCIAnalysisMarker` invisible HTML comment convention: `src/lib/ci-failure-formatter.ts` lines 6-13
- M028-S01 verifier structure (check-ID envelope, DB-gated skip, CLI runner): `scripts/verify-m028-s01.ts`
- Current publish tracking schema gaps (no `published_comment_id`): `src/db/migrations/024-wiki-update-publishing.sql`
- S01 forward intelligence confirming `PageSuggestionGroup.modificationMode` and `modification_mode` column are the comment-targeting seam: `.gsd/milestones/M028/slices/S01/S01-SUMMARY.md`
