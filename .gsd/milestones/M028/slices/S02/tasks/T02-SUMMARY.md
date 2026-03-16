---
id: T02
parent: S02
milestone: M028
provides:
  - retrofitPreview branch in publish() — scan-only GitHub reads, returns RetrofitPreviewResult per pending page
  - --retrofit-preview and --issue-number CLI flags in scripts/publish-wiki-updates.ts
  - retrofitPreviewResult field on PublishResult
  - 3 new retrofit-preview tests (update-path, create-path, no-mutation); 37 total passing
key_files:
  - src/knowledge/wiki-publisher.ts
  - src/knowledge/wiki-publisher-types.ts
  - src/knowledge/wiki-publisher.test.ts
  - scripts/publish-wiki-updates.ts
key_decisions:
  - retrofitPreview branch re-uses the octokit fetched in pre-flight (when dryRun=false) via if (!octokit) guard, avoiding a redundant GitHub App call
  - When both retrofitPreview=true and dryRun=true are set, the publisher logs a warning but proceeds (retrofit-preview needs a live GitHub connection to scan); CLI sets up real GitHubApp when retrofitPreview is set regardless of dryRun
  - retrofitPreview only covers pages with pending unpublished suggestions (same SQL query as normal path); already-published pages are not in the group list and are omitted from the result
patterns_established:
  - retrofit-preview scan loop mirrors upsertWikiPageComment scan (up to 10 pages, per_page=100, desc) but reads only — no mutation methods called
  - CLI action table uses fixed-width column padding for readable terminal output; no external table library needed
observability_surfaces:
  - logger.info({ pageId, pageTitle, action, existingCommentId }) per planned action from retrofit-preview path
  - CLI prints: "Retrofit Preview — Issue #N" + ACTION|PAGE|COMMENT ID|WIKI URL table
  - Missing --issue-number with --retrofit-preview exits with "Error: --retrofit-preview requires --issue-number <n>"
  - publisher throws "retrofitPreview requires issueNumber in runOptions" if called programmatically without issueNumber
duration: ~35min
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T02: Retrofit Preview Path and CLI Flag

**Added `retrofitPreview` execution path to the publisher and `--retrofit-preview`/`--issue-number` CLI flags, enabling operators to preview planned comment actions (update/create) on an existing tracking issue without mutating GitHub.**

## What Happened

1. **`wiki-publisher-types.ts`**: Added `retrofitPreviewResult?: RetrofitPreviewResult` to `PublishResult`. The `RetrofitPageAction`, `RetrofitPreviewResult`, `issueNumber`, and `retrofitPreview` fields were already present from T01.

2. **`wiki-publisher.ts`**: Added the `retrofitPreview` branch as step 4a inside `publish()`, guarded by `runOptions.retrofitPreview === true`. The branch:
   - Throws `"retrofitPreview requires issueNumber in runOptions"` if `issueNumber` is missing
   - Logs a warning if `dryRun` is also set (ignores it, proceeds with live GitHub)
   - Re-uses the pre-flight `octokit` (already fetched when `!dryRun`) via an `if (!octokit)` guard to avoid double auth
   - Scans `issueNumber` for each pending page group using the same 10-page pagination loop as `upsertWikiPageComment`
   - Returns `RetrofitPreviewResult` with per-page `action: 'update' | 'create'` and `existingCommentId`
   - Logs `logger.info({ pageId, pageTitle, action, existingCommentId })` per planned action
   - **Never calls `createComment` or `updateComment`**

3. **`scripts/publish-wiki-updates.ts`**: Added `--retrofit-preview` (boolean) and `--issue-number` (string) to `parseArgs` options; updated help text; added validation that `--issue-number` is required with `--retrofit-preview`; wired real GitHubApp setup when `retrofitPreview` is set (even alongside `--dry-run`); added action table printer to stdout.

4. **`wiki-publisher.test.ts`**: Added 3 retrofit-preview tests under `createWikiPublisher — retrofitPreview` describing update-path, create-path, and no-mutation contract.

5. **`S02-PLAN.md`**: Fixed pre-flight observability gap by adding concrete failure-state diagnostic command (`bun run verify:m028:s02 --json 2>&1 | jq '.checks[] | select(.status != "pass")'`) to the Verification section.

## Verification

```
bun test src/knowledge/wiki-publisher.test.ts
# → 37 pass, 0 fail

bun scripts/publish-wiki-updates.ts --help | grep -q 'retrofit-preview'
# → PASS

bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types|publish-wiki'
# → (no output) — target files clean
```

## Diagnostics

- Run `bun scripts/publish-wiki-updates.ts --retrofit-preview --issue-number N` to see the action table without mutating GitHub
- Structured log signal: `logger.info({ pageId, pageTitle, action, existingCommentId })` per planned action
- Error path: missing `--issue-number` exits with `"Error: --retrofit-preview requires --issue-number <n>"`
- Programmatic error path: `publisher.publish({ retrofitPreview: true })` (no issueNumber) throws `"retrofitPreview requires issueNumber in runOptions"`

## Deviations

None. Plan implemented as specified.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/wiki-publisher.ts` — Added `retrofitPreview` branch (step 4a) in `publish()`; imported `RetrofitPageAction` and `RetrofitPreviewResult` types
- `src/knowledge/wiki-publisher-types.ts` — Added `retrofitPreviewResult?: RetrofitPreviewResult` to `PublishResult`
- `src/knowledge/wiki-publisher.test.ts` — 3 new retrofit-preview tests (37 total)
- `scripts/publish-wiki-updates.ts` — `--retrofit-preview` and `--issue-number` flags, validation, action table printer, real GitHub App setup when retrofitPreview active
- `.gsd/milestones/M028/slices/S02/S02-PLAN.md` — Fixed pre-flight observability gap in Verification section
