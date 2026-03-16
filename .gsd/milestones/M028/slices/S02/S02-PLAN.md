# S02: Deterministic Retrofit & Comment Identity Surface

**Goal:** Operators can preview exactly which existing `xbmc/wiki` comments will be updated or superseded, using stable comment identity or deterministic markers rather than manual thread cleanup.

**Demo:** Running `bun scripts/publish-wiki-updates.ts --retrofit-preview --issue-number <N>` prints a per-page planned-action table (update / create / no-op) without mutating GitHub. Verifier `bun run verify:m028:s02 --json` returns `overallPassed: true` with all four checks passing or DB-gated checks skipping cleanly.

## Must-Haves

- Migration 031: `published_comment_id BIGINT` column on `wiki_update_suggestions`
- `formatPageComment()` embeds `<!-- kodiai:wiki-modification:{pageId} -->` as the first line of every comment body
- `upsertWikiPageComment()` replaces `postCommentWithRetry` in the live publish path — scans by marker, calls `updateComment` if found, `createComment` otherwise; persists `published_comment_id` in the DB mark-published step
- `retrofitPreview()` path in `publish()` — reads GitHub, does not write; returns `RetrofitPreviewResult` with per-page `update` / `create` / `no-op` actions
- `--retrofit-preview` CLI flag in `scripts/publish-wiki-updates.ts`
- Verifier `scripts/verify-m028-s02.ts` with four check IDs (two pure-code, two DB-gated), matching test suite, and `package.json` alias

## Proof Level

- This slice proves: operational — marker scanning and upsert contract are exercised with mock GitHub clients; retrofit-preview output is tested; DB schema check runs against real Postgres when DATABASE_URL is available
- Real runtime required: no (live GitHub mutation not required; DB checks skip gracefully when offline)
- Human/UAT required: no

## Verification

```
# Pure-code (always run):
bun test src/knowledge/wiki-publisher.test.ts         # includes marker, upsert-update, upsert-create, retrofit-preview tests
bun run verify:m028:s02 --json                        # overallPassed: true; pure-code checks pass; DB checks pass or db_unavailable

# Test suite:
bun test ./scripts/verify-m028-s02.test.ts            # 20+ tests covering check IDs, envelope shape, pure-code pass/fail, DB-gated skip

# TypeScript:
bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types|verify-m028-s02|publish-wiki'
# → (no output) — zero errors on S02 target files

# CLI smoke:
bun scripts/publish-wiki-updates.ts --help | grep -q 'retrofit-preview'
```

## Observability / Diagnostics

- Runtime signals: `logger.info({ pageId, pageTitle, action })` from retrofit-preview path; `logger.debug({ commentId, pageId })` from upsert (update vs create branch)
- Inspection surfaces: `bun run verify:m028:s02 --json`; `bun scripts/publish-wiki-updates.ts --retrofit-preview --issue-number N`
- Failure visibility: verifier check `M028-S02-COMMENT-ID-SCHEMA` reports `db_unavailable` vs `column_missing` vs `schema_ok`; `M028-S02-PUBLISHED-LINKAGE` reports `no_published_rows` (pass) vs `linkage_gap_found` (fail)
- Redaction constraints: no secrets emitted; comment IDs are GitHub public identifiers

## Integration Closure

- Upstream surfaces consumed: `formatPageComment()` (S01), `PageSuggestionGroup.modificationMode` (S01), `wiki_update_suggestions.modification_mode` column (migration 030, S01), `upsertCIComment` + `buildCIAnalysisMarker` patterns (ci-failure.ts / ci-failure-formatter.ts)
- New wiring introduced in this slice: `upsertWikiPageComment()` wired into the live publish loop (replaces `postCommentWithRetry` call); `retrofitPreview` branch added to `publish()`; `--retrofit-preview` flag in CLI
- What remains before the milestone is truly usable end-to-end: S03 (live publication through the real xbmc/wiki tracking issue using the upsert path) and S04 (final integrated acceptance with regression guards)

## Tasks

- [ ] **T01: Migration 031, comment marker, and upsert contract** `est:1.5h`
  - Why: The DB schema dependency (published_comment_id) and the stable HTML marker are the foundation for all scan-based identity work. The upsert function replaces the create-only postCommentWithRetry call so future publish runs update existing comments instead of creating duplicates.
  - Files: `src/db/migrations/031-wiki-comment-identity.sql`, `src/db/migrations/031-wiki-comment-identity.down.sql`, `src/knowledge/wiki-publisher.ts`, `src/knowledge/wiki-publisher-types.ts`, `src/knowledge/wiki-publisher.test.ts`
  - Do:
    1. Write `src/db/migrations/031-wiki-comment-identity.sql`: `ALTER TABLE wiki_update_suggestions ADD COLUMN published_comment_id BIGINT;` (BIGINT required — GitHub comment IDs exceed 32-bit range)
    2. Write `src/db/migrations/031-wiki-comment-identity.down.sql`: `ALTER TABLE wiki_update_suggestions DROP COLUMN IF EXISTS published_comment_id;`
    3. In `formatPageComment()` in `wiki-publisher.ts`, prepend `<!-- kodiai:wiki-modification:${group.pageId} -->` as the very first line of the output (before the `## Title` heading). This is a pure-code change — the marker is hidden HTML and does not affect visible rendering. Must not break existing S01 negative guards (`not.toContain("**Why:**")`, `not.toContain(":warning:")`).
    4. Add `upsertWikiPageComment()` function to `wiki-publisher.ts`. Pattern: loop up to 10 pages of `octokit.rest.issues.listComments({ per_page: 100, sort: "created", direction: "desc" })` scanning for the marker `<!-- kodiai:wiki-modification:${pageId} -->`. If found, call `updateComment`; if not found after exhausting pages, call `createComment`. Return `{ commentId: number, action: 'updated' | 'created' }`. Wrap scan in try/catch — on scan failure, log debug and proceed to createComment. Follow the `upsertCIComment` pattern from `src/handlers/ci-failure.ts` lines 263–335.
    5. In `wiki-publisher-types.ts`, add to `PagePostResult`: `commentAction?: 'updated' | 'created'`. Add to `PublishRunOptions`: `retrofitPreview?: boolean`. Add new types `RetrofitPageAction` (`{ pageId: number; pageTitle: string; action: 'update' | 'create' | 'no-op'; existingCommentId: number | null }`) and `RetrofitPreviewResult` (`{ actions: RetrofitPageAction[]; issueNumber: number }`).
    6. In the live publish loop in `wiki-publisher.ts` (the `for` loop over `groups`), replace the `postCommentWithRetry` call with `upsertWikiPageComment`. Update the DB mark-published step to also write `published_comment_id`: `SET published_at = NOW(), published_issue_number = ${issueNumber}, published_comment_id = ${result.commentId}`.
    7. Add tests to `wiki-publisher.test.ts`:
       - `formatPageComment` output starts with `<!-- kodiai:wiki-modification:${pageId} -->`
       - `upsertWikiPageComment` calls `updateComment` when `listComments` returns a comment containing the marker (mock listComments returning one match)
       - `upsertWikiPageComment` calls `createComment` when `listComments` returns no match
       - marker presence does not break S01 negative guards (no `**Why:**`, no `:warning:`)
  - Verify: `bun test src/knowledge/wiki-publisher.test.ts` (all tests pass including new ones); `bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types'` → no output
  - Done when: all publisher tests pass, TypeScript clean on target files, migration files exist, marker appears in formatPageComment output, upsertWikiPageComment follows update-or-create contract

- [ ] **T02: Retrofit preview path and CLI flag** `est:1h`
  - Why: The retrofit-preview mode gives operators a safe way to inspect planned comment actions (update vs create vs no-op) on an existing tracking issue without mutating GitHub. This is the operational surface S02 is named for.
  - Files: `src/knowledge/wiki-publisher.ts`, `src/knowledge/wiki-publisher-types.ts`, `scripts/publish-wiki-updates.ts`, `src/knowledge/wiki-publisher.test.ts`
  - Do:
    1. In `wiki-publisher.ts`, add a `retrofitPreview()` method (or branch inside `publish()`) guarded by `runOptions.retrofitPreview === true`. This path:
       - Requires a live Octokit — explicitly documented as mutually exclusive with `dryRun: true`. If both are set, log a warning and ignore `dryRun` (retrofit-preview needs to read GitHub to scan comments).
       - Fetches unpublished groups from DB using the same query as the normal publish path (same `pageIds`, `groundedOnly` filters).
       - For each group, scans `issueNumber` (required when `retrofitPreview` is true — must be supplied via `runOptions.issueNumber` or `--issue-number` CLI flag) using the marker `<!-- kodiai:wiki-modification:${pageId} -->` — same pagination pattern as `upsertWikiPageComment`. Does NOT post or update anything.
       - Returns `RetrofitPreviewResult` with per-page `action: 'update' | 'create'` plus `existingCommentId` (null for create).
       - Pages with no unpublished suggestions report `action: 'no-op'` (already published rows found in DB with `published_at IS NOT NULL` — or skip entirely if not in group list).
       - Log `logger.info({ pageId, pageTitle, action, existingCommentId })` for each planned action.
    2. Add `issueNumber?: number` to `PublishRunOptions` (needed for retrofit-preview scan target).
    3. In `scripts/publish-wiki-updates.ts`:
       - Add `--retrofit-preview` boolean flag (default: false) to `parseArgs` options.
       - Add `--issue-number` string flag (default: undefined).
       - When `--retrofit-preview` is set: call `publisher.publish({ retrofitPreview: true, issueNumber: parsedIssueNumber, pageIds, groundedOnly })` and print a human-readable table: `Action | Page | Comment ID | Wiki URL` with one row per page action.
       - Document in help text: `--retrofit-preview  Scan issue for existing wiki comments and preview planned actions (requires --issue-number; reads GitHub but does not post)`
    4. Add tests to `wiki-publisher.test.ts`:
       - `retrofitPreview` returns `action: 'update'` when mock `listComments` returns matching marker comment
       - `retrofitPreview` returns `action: 'create'` when mock `listComments` returns no match
       - `retrofitPreview` does not call `createComment` or `updateComment` on mock Octokit
  - Verify: `bun test src/knowledge/wiki-publisher.test.ts`; `bun scripts/publish-wiki-updates.ts --help | grep -q retrofit-preview`; `bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|publish-wiki'` → no output
  - Done when: publisher tests include retrofit-preview coverage; CLI `--help` lists `--retrofit-preview`; TypeScript clean on target files; retrofit-preview does not call any mutation methods on mock Octokit

- [ ] **T03: Verifier, test suite, and package.json alias** `est:1h`
  - Why: The S02 proof harness provides machine-checkable evidence that all four surfaces work — the marker contract (pure-code), the upsert contract (pure-code), the DB schema column (DB-gated), and published-row linkage (DB-gated). Follows the S01 verifier pattern exactly.
  - Files: `scripts/verify-m028-s02.ts`, `scripts/verify-m028-s02.test.ts`, `package.json`
  - Do:
    1. Write `scripts/verify-m028-s02.ts` following the `verify-m028-s01.ts` structure:
       - Export `M028_S02_CHECK_IDS` constant array: `["M028-S02-COMMENT-MARKER", "M028-S02-UPSERT-CONTRACT", "M028-S02-COMMENT-ID-SCHEMA", "M028-S02-PUBLISHED-LINKAGE"]`
       - Export `M028S02Check`, `M028S02EvaluationReport` types matching S01 shape
       - Export `evaluateM028S02(sql?: unknown): Promise<M028S02EvaluationReport>`
       - Export `buildM028S02ProofHarness(): Promise<void>` for CLI runner
       - **`M028-S02-COMMENT-MARKER`** (pure-code): Call `formatPageComment({ pageId: 42, pageTitle: "Test", modificationMode: "section", suggestions: [...] }, "xbmc", "xbmc")`. Assert the output starts with `<!-- kodiai:wiki-modification:42 -->`. Pass if true; fail with offending first-line snippet if false.
       - **`M028-S02-UPSERT-CONTRACT`** (pure-code): Create a mock Octokit with `listComments` returning a comment containing `<!-- kodiai:wiki-modification:99 -->` (match path) and another mock with `listComments` returning empty (create path). Call `upsertWikiPageComment` on each. Assert the first calls `updateComment` (not `createComment`) and the second calls `createComment` (not `updateComment`). Both must return `{ commentId, action }`.
       - **`M028-S02-COMMENT-ID-SCHEMA`** (DB-gated): Query `information_schema.columns WHERE table_name = 'wiki_update_suggestions' AND column_name = 'published_comment_id'`. Pass if column exists; skip with `db_unavailable` if DB is unreachable; fail with `column_missing` if DB is reachable but column absent.
       - **`M028-S02-PUBLISHED-LINKAGE`** (DB-gated): Query `SELECT COUNT(*) as gap FROM wiki_update_suggestions WHERE published_at IS NOT NULL AND published_comment_id IS NULL`. Pass with `no_linkage_gap` if count = 0 (no published rows without comment ID); pass with `no_published_rows` if table has zero published rows; fail with `linkage_gap_found` + gap count if gap > 0.
       - DB connect failures → `db_unavailable` (skipped), consistent with S01 pattern. Use `createDbClient` from `../src/db/client.ts`.
       - CLI runner: `if (import.meta.main)` block; parse `--json` flag; call `buildM028S02ProofHarness()` or print human-readable; exit 0 on `overallPassed`, 1 otherwise.
    2. Write `scripts/verify-m028-s02.test.ts` with 20+ tests:
       - Check ID list matches `M028_S02_CHECK_IDS` (4 entries, exact names)
       - Envelope shape: `overallPassed`, `check_ids`, `checks` array
       - Pure-code `COMMENT-MARKER`: passes with valid marker in output, fails with wrong pageId
       - Pure-code `UPSERT-CONTRACT`: update-path mock → `action: 'updated'`; create-path mock → `action: 'created'`
       - DB-gated `COMMENT-ID-SCHEMA`: skips gracefully when `sql` is undefined
       - DB-gated `PUBLISHED-LINKAGE`: skips gracefully when `sql` is undefined
       - `overallPassed` is false only when a non-skipped check fails
       - All four check IDs present in result even when DB checks are skipped
    3. Add to `package.json` scripts: `"verify:m028:s02": "bun scripts/verify-m028-s02.ts"`
  - Verify: `bun test ./scripts/verify-m028-s02.test.ts` (20+ pass); `bun run verify:m028:s02 --json` exits 0 with `overallPassed: true`; `bunx tsc --noEmit 2>&1 | grep verify-m028-s02` → no output
  - Done when: all verifier tests pass; `verify:m028:s02` alias works; pure-code checks always pass; DB checks skip cleanly when DATABASE_URL is absent; TypeScript clean on verifier files

## Files Likely Touched

- `src/db/migrations/031-wiki-comment-identity.sql` (new)
- `src/db/migrations/031-wiki-comment-identity.down.sql` (new)
- `src/knowledge/wiki-publisher.ts`
- `src/knowledge/wiki-publisher-types.ts`
- `src/knowledge/wiki-publisher.test.ts`
- `scripts/publish-wiki-updates.ts`
- `scripts/verify-m028-s02.ts` (new)
- `scripts/verify-m028-s02.test.ts` (new)
- `package.json`
