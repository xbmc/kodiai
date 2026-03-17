# S03: Live Modification-Only Wiki Publishing — Research

**Date:** 2026-03-16

## Summary

S03 is the live-execution slice. Its job is to do three things that are still undone: (1) actually implement the modification-only output contract that S01 claimed but did not deliver, (2) wire the publisher so it can post to an existing issue rather than always creating a new one, and (3) run a real live publish to xbmc/wiki issue #5 that supersedes the old suggestion-style comments with modification-only content.

**Critical finding: S01's claimed deliverables do not exist on disk.** The S01-SUMMARY describes `parseModificationContent()`, `modificationMode`, `replacementContent`, migration 030, and a fully-rewritten publisher as completed work. None of this is true:
- `src/knowledge/wiki-update-types.ts` has no `modificationMode`, `replacementContent`, or `pageModeThreshold` fields
- `src/knowledge/wiki-publisher.ts` still emits `**Why:** ${s.whySummary}` and `:warning:` voice-mismatch prose on line 51 and 63–66
- `src/db/migrations/030-wiki-modification-artifacts.sql` does not exist
- No `verify-m028-s01.ts` or `verify:m028:s01` package alias exists

S02 built correctly on top of the existing (unmodified) publisher: it added the HTML identity marker in `formatPageComment()` (the test suite checks `markerLine`, not the full comment), upsert-based publishing via `upsertWikiPageComment()`, retrofit-preview, and migration 031 (`published_comment_id`). S02 is solid, but it inherited all the old suggestion-prose from the pre-S01 publisher.

The net effect: S03 must do everything S01 was supposed to do (modification-only contract + migration 030), while preserving all of S02's infrastructure (marker, upsert, retrofit-preview, migration 031). Then S03 must prove the live publish path works end-to-end.

**Live state on xbmc/wiki:** Issue #5 ("Wiki Update Suggestions — 2026-03-12") exists with 8 suggestion-style page comments (none have the modification marker). The DB has 21 published rows, all with `published_comment_id=0` (sentinel for "published before identity tracking"), all pointing to issue #5. There are 83 unpublished rows (grounded/partially-grounded). The publisher always creates a new tracking issue — there is currently no `--issue-number` option for live publish (only for `--retrofit-preview`). S03 must add that.

## Recommendation

S03 has three tasks:

**T01: Complete the S01 modification-only contract (what S01 claimed).** Add `modificationMode: 'section' | 'page'` and `replacementContent: string` to `UpdateSuggestion` in `wiki-update-types.ts`. Add `whySummary` as nullable. Add migration 030 (`replacement_content TEXT`, `modification_mode TEXT NOT NULL DEFAULT 'section'`; updated unique index). Rewrite `formatPageComment()` to emit only `replacementContent` + PR citations — strip `**Why:**` and voice-mismatch prose. Update the DB SELECT in `publish()` to read `replacement_content` and `modification_mode`, with fallback to `suggestion` for legacy rows. Update `PageSuggestionGroup` type to carry `replacementContent` and `modificationMode`. Update `formatSummaryTable()` to say "Wiki Modification Artifacts". Add `parseModificationContent()` alongside deprecated `parseGeneratedSuggestion()`. Add `verify-m028-s01.ts` and `verify:m028:s01` package alias. Rewrite publisher tests with negative `not.toContain("**Why:**")` guards.

**T02: Add `--issue-number` for live publish (not just retrofit-preview).** The current publish flow always calls `issues.create`. For live publish to an existing issue (xbmc/wiki #5), `PublishRunOptions` needs `issueNumber?: number`. When provided, skip `issues.create` and post comments directly to the supplied issue. The `--issue-number` CLI flag already exists but is currently only wired to `--retrofit-preview`; wire it to the publish flow as well.

**T03: Live publish run + S03 verifier.** Run `bun scripts/publish-wiki-updates.ts --issue-number 5` against the real xbmc/wiki issue. This will call `upsertWikiPageComment` for the 8 already-published pages (update existing comments) and create new comments for newly-published pages. After publish, confirm `published_comment_id` is written with real GitHub comment IDs (non-zero). Build `scripts/verify-m028-s03.ts` with check IDs: `M028-S03-NO-WHY-IN-RENDER` (pure-code, always run), `M028-S03-LIVE-MARKER` (DB-gated: published rows have non-zero `published_comment_id`), `M028-S03-COMMENT-BODY` (live-GitHub: scan xbmc/wiki issue #5, confirm comments contain marker and do NOT contain `**Why:**`), `M028-S03-SENTINEL-CLEARED` (DB-gated: zero rows with `published_comment_id=0` after the live run).

## Implementation Landscape

### Key Files

- `src/knowledge/wiki-update-types.ts` — Add `modificationMode`, `replacementContent` (required), `whySummary` nullable; add `pageModeThreshold` to `UpdateGeneratorOptions`. This is the type boundary.
- `src/knowledge/wiki-publisher-types.ts` — `PageSuggestionGroup.suggestions` items need `replacementContent: string` added, `whySummary` made optional; add `modificationMode` to the group type.
- `src/knowledge/wiki-publisher.ts` — **Critical**: strip `**Why:**` on line 51 and `:warning:` voice-mismatch prose on lines 63–66. Update DB SELECT at line 322 to include `replacement_content` and `modification_mode`. Update group builder at lines 343–358 to use `replacementContent` with `suggestion` fallback. Add `issueNumber` support to `publish()` — skip `issues.create` when `issueNumber` is provided. Update `formatSummaryTable()` header.
- `src/knowledge/wiki-publisher.test.ts` — Add `not.toContain("**Why:**")` and `not.toContain(":warning:")` guards for `formatPageComment`. Tests currently PASS because the S02-added marker tests only check the first line (marker), not the full body.
- `src/knowledge/wiki-update-generator.ts` — Add `parseModificationContent()` alongside deprecated `parseGeneratedSuggestion()`. Add `storeSuggestion()` writing `replacement_content` and `modification_mode`. The `buildGroundedSectionPrompt` still instructs the model to use `WHY:` — `parseModificationContent` should strip it silently with a warning log.
- `src/knowledge/wiki-update-generator.test.ts` — Add tests for `parseModificationContent`.
- `src/db/migrations/030-wiki-modification-artifacts.sql` — Add `replacement_content TEXT`, `modification_mode TEXT NOT NULL DEFAULT 'section'`; update unique index to `(page_id, modification_mode, COALESCE(section_heading, ''))`.
- `src/db/migrations/030-wiki-modification-artifacts.down.sql` — Rollback migration.
- `scripts/generate-wiki-updates.ts` — Update CLI summary language to "Modifications generated / dropped".
- `scripts/publish-wiki-updates.ts` — Wire `--issue-number` to live publish (not just retrofit-preview). Current check at line 71-80 only activates when `retrofitPreview` is also set. Extend to allow `--issue-number` without `--retrofit-preview`.
- `scripts/verify-m028-s01.ts` — **New**: 4-check harness (NO-WHY-IN-RENDER, PR-CITATIONS, ARTIFACT-CONTRACT DB-gated, MODE-FIELD DB-gated).
- `scripts/verify-m028-s01.test.ts` — **New**: tests for S01 verifier.
- `scripts/verify-m028-s03.ts` — **New**: S03 proof harness (live-oriented, includes GitHub scan check).
- `scripts/verify-m028-s03.test.ts` — **New**: tests for S03 verifier pure-code and DB checks.
- `package.json` — Add `verify:m028:s01` and `verify:m028:s03` aliases.

### Build Order

1. **Migration 030 first.** Everything downstream (types, generator, publisher) depends on the schema having `replacement_content` and `modification_mode`. The migration is additive with defaults (`'section'`) so existing rows stay valid. Apply it before running any tests.

2. **Type contract (wiki-update-types.ts, wiki-publisher-types.ts) second.** Gets TypeScript happy before touching generator/publisher logic.

3. **formatPageComment() rewrite + negative guards in publisher tests.** This is the most visible part of S01's claim and the direct regression risk. Once `formatPageComment` is clean, the marker tests already in place continue to pass and the new `not.toContain("**Why:**")` guards lock the contract.

4. **Publisher DB SELECT + group builder + issueNumber support.** Read `replacement_content` and `modification_mode` from DB; use `suggestion` column as fallback for legacy rows (backward compat). Add `issueNumber` param to skip `issues.create`.

5. **parseModificationContent() + generator updates.** Parallel to publisher work; needed for new artifact generation but existing rows (83 unpublished, 21 published) already have the old schema shape. The fallback to `suggestion` in the publisher means old rows can publish without regeneration.

6. **verify-m028-s01.ts** — Locks the pure-code contract. Run this before any live GitHub calls.

7. **CLI `--issue-number` for live publish.** Extend `publish-wiki-updates.ts` to pass `issueNumber` to `publisher.publish()` when provided.

8. **Live publish run against xbmc/wiki issue #5.** After S01 contract is locked: run `bun scripts/publish-wiki-updates.ts --issue-number 5`. The 8 existing suggestion-style comments will be superseded (upsert updates them if they match... but they won't match the marker). Actually, the existing comments don't have the HTML marker, so `upsertWikiPageComment` will NOT find them and will instead create new comments. This is the correct supersession strategy — post modification-only replacement comments, leave the old suggestion comments as historical record. Operators can then close/delete the old ones manually. Confirm `published_comment_id` is written as a real GitHub comment ID (non-zero).

9. **verify-m028-s03.ts** — Proof harness including the live-state checks.

### Verification Approach

```
# Pure-code contract (always runnable offline):
bun run verify:m028:s01 --json
# → overallPassed: true, NO-WHY-IN-RENDER: pass, PR-CITATIONS: pass

# Publisher test suite with negative guards:
bun test src/knowledge/wiki-publisher.test.ts
# → 37+ pass, 0 fail; no **Why:** in formatPageComment output

# Generator tests:
bun test src/knowledge/wiki-update-generator.test.ts
# → all pass; parseModificationContent tests present

# Dry-run: inspect output contains no **Why:** before live publish:
bun scripts/publish-wiki-updates.ts --dry-run --output /tmp/wiki-dry-run.md
grep -c '**Why:**' /tmp/wiki-dry-run.md
# → 0

# Live publish to existing issue:
bun scripts/publish-wiki-updates.ts --issue-number 5
# → posts modification-only comments to xbmc/wiki issue #5

# DB confirmation: published_comment_id is non-zero after live run:
bun run verify:m028:s03 --json
# → LIVE-MARKER: pass, SENTINEL-CLEARED: pass (or reduced)

# TypeScript type check on S03 target files:
bunx tsc --noEmit 2>&1 | grep -E 'wiki-update|wiki-publisher|verify-m028|generate-wiki|publish-wiki'
# → (no output)
```

## Constraints

- **S02 infrastructure must be preserved.** The HTML marker in `formatPageComment`, `upsertWikiPageComment`, `RetrofitPreviewResult`, `RetrofitPageAction`, and migration 031 are all working and tested (37 passing tests). S03 changes `formatPageComment` body rendering but must keep the marker as first line.
- **`formatPageComment` first line must remain `<!-- kodiai:wiki-modification:{pageId} -->`.** The S02 marker tests (`formatPageComment — comment identity marker` block) check `result.split("\n")[0]`. Do not disturb.
- **Existing published rows (21 sentinel rows) will not be superseded automatically.** The `upsertWikiPageComment` scan looks for the HTML marker, which none of the 8 existing xbmc/wiki comments have. So the live publish will create new modification-only comments alongside the old suggestion-style ones. That is acceptable for S03 — the new comments are the canonical artifacts. S04 can optionally clean up old comments. Do not try to match old comments by page title or position.
- **83 unpublished rows use the `suggestion` column for content.** No regeneration is needed for S03 — the publisher falls back to `suggestion` when `replacement_content IS NULL`. The modification-only rendering applies regardless: the content of `suggestion` (the old section rewrite) is rendered without the `**Why:**` wrapper.
- **Migration 030 must use `IF NOT EXISTS` guards** or be skipped gracefully (like migration 031 failed because `published_comment_id` already existed). Apply migration 030 with `ADD COLUMN IF NOT EXISTS` syntax.
- **Pre-existing TS errors.** There are ~53 unrelated TypeScript errors from M027 work. Use `grep -E` to scope tsc checks to S03 target files only.
- **The `--issue-number` flag is already parsed** in `scripts/publish-wiki-updates.ts` but only used in the retrofit-preview branch. Reuse the same variable.

## Common Pitfalls

- **Don't disturb the marker line.** The test `formatPageComment — comment identity marker > starts with the wiki-modification marker` checks `result.startsWith(expectedMarker)`. The new rendering must keep the marker on line 1, followed by blank line, then `## {pageTitle}`.
- **Don't confuse `--issue-number` scopes.** Currently `retrofitIssueNumber` is only set when `retrofitPreview=true`. For the live publish path, `--issue-number` without `--retrofit-preview` should pass `issueNumber` to `publisher.publish()`. The existing variable can be reused.
- **Upsert won't find old comments.** The 8 existing issue #5 comments have no HTML marker — `upsertWikiPageComment` will call `createComment` for all 8, producing duplicate page comments. This is by design for S03 (new contract vs. legacy record). Do not add page-title-based matching; it is fragile and out of scope.
- **`published_comment_id=0` rows are NOT real IDs.** After live publish, only newly-created/updated comments will have real comment IDs. The 21 sentinel rows remain at 0 until re-published through the upsert path. `SENTINEL-CLEARED` check should report progress, not demand zero rows.
- **`formatPageComment` for page-mode groups.** The S01 design says page-mode groups have exactly one `suggestions[0]` entry (the stitched artifact). The current loop-over-suggestions in `formatPageComment` will still work correctly since it iterates `group.suggestions` regardless. No special case needed for S03 since there are no page-mode rows in the DB yet.
- **`--issue-number` makes `issueNumber` parsing happen unconditionally now.** The CLI currently only parses `--issue-number` into `retrofitIssueNumber` inside the `if (retrofitPreview)` block. Move the parsing outside that block so it applies to live publish too.
- **Voice-mismatch prose must be removed from the comment body, not just the test fixture.** The actual `formatPageComment` function on line 63–66 appends `:warning: **Voice mismatch**` unconditionally when `s.voiceMismatchWarning` is true. Delete those 4 lines.
- **`formatSummaryTable` "Voice Warnings" column.** The summary table in `formatSummaryTable` includes a "Voice Warnings" column. Remove it as part of the modification-only contract. Watch for any tests that assert the old column header.

## Open Risks

- **Live publish creates new comments instead of updating old ones.** The 8 existing xbmc/wiki issue #5 comments will not be superseded — new modification-only comments will be created alongside them, resulting in 16 comments for 8 pages (old + new). This is acceptable for S03 and the milestone proof, but the wiki operators may want the old comments cleaned up. S04 should address this explicitly if needed.
- **83 unpublished rows.** A full live publish to issue #5 with `--issue-number 5` will create up to 83 additional comments (many pages with multiple sections). Consider using `--page-ids` to scope the first live run to a small set for verification, then expand. The dry-run output should be reviewed before the full live run.
- **`suggestion` column content quality.** The 83 unpublished rows were generated under the old `WHY:`-prompted contract. Their `suggestion` text may start with `WHY:` or contain rationale fragments. `parseModificationContent` should also be applied to the `suggestion` fallback path to strip any `WHY:` prefix before rendering.
