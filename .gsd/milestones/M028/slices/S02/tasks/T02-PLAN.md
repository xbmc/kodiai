---
estimated_steps: 4
estimated_files: 4
---

# T02: Retrofit Preview Path and CLI Flag

**Slice:** S02 — Deterministic Retrofit & Comment Identity Surface
**Milestone:** M028

## Description

Add the `retrofitPreview` execution path to the publisher — scans a target issue for existing wiki marker comments and returns a `RetrofitPreviewResult` with per-page planned actions (`update` / `create` / `no-op`) without mutating GitHub. Wire a `--retrofit-preview` CLI flag into `scripts/publish-wiki-updates.ts` that invokes this path and prints a human-readable action table.

## Steps

1. In `src/knowledge/wiki-publisher.ts`, add a `retrofitPreview()` private method or branch inside `publish()` guarded by `runOptions.retrofitPreview === true`. This path:
   - **Does not write to DB or call GitHub mutation APIs** — scan-only.
   - Requires `runOptions.issueNumber` (the existing tracking issue to scan). If missing, throw with a clear message: `"retrofitPreview requires issueNumber in runOptions"`.
   - If `runOptions.dryRun` is also set: log `logger.warn("retrofitPreview ignores dryRun — it needs a live GitHub connection to scan comments")` and proceed (retrofit-preview reads GitHub; `dryRun` would prevent that).
   - Fetch unpublished page groups from DB using the same SQL query as the normal publish path (respecting `pageIds` and `groundedOnly` filters). This reuses the existing group-builder logic before the issue-creation step.
   - For each group, scan `runOptions.issueNumber` using `octokit.rest.issues.listComments` with the same pagination pattern as `upsertWikiPageComment` (up to 10 pages, per_page 100, descending). Look for `<!-- kodiai:wiki-modification:${group.pageId} -->`.
   - Return `RetrofitPreviewResult`:
     ```typescript
     {
       actions: [
         { pageId, pageTitle, action: 'update', existingCommentId: <found id> },
         { pageId, pageTitle, action: 'create', existingCommentId: null },
         // ... one entry per group
       ],
       issueNumber: runOptions.issueNumber
     }
     ```
   - Pages with no unpublished suggestions (not in group list) are omitted from the result — the preview only covers pages with pending work.
   - Log `logger.info({ pageId, pageTitle, action, existingCommentId })` for each planned action so operators can see the preview in structured logs.
   - Return this result from `publish()` as a new `retrofitPreviewResult` field on `PublishResult` (add `retrofitPreviewResult?: RetrofitPreviewResult` to `PublishResult` in `wiki-publisher-types.ts`).

2. In `scripts/publish-wiki-updates.ts`:
   - Add to `parseArgs` options:
     ```
     "retrofit-preview": { type: "boolean", default: false },
     "issue-number": { type: "string" },
     ```
   - Add to help text:
     ```
     --retrofit-preview    Scan issue for existing wiki comments, preview planned actions
                           (requires --issue-number; reads GitHub, does not post)
     --issue-number <n>    Target issue number for --retrofit-preview
     ```
   - When `--retrofit-preview` is set:
     - Parse `--issue-number` as integer; error if not provided.
     - Call `publisher.publish({ retrofitPreview: true, issueNumber: parsedIssueNumber, pageIds, groundedOnly })`.
     - Print a table to stdout:
       ```
       Retrofit Preview — Issue #N
       
       ACTION   | PAGE                     | COMMENT ID | WIKI URL
       ---------+--------------------------+------------+----------------------------------
       update   | Kodi v21 (Omega)         | 5001       | https://kodi.wiki/view/Kodi_v21_(Omega)
       create   | PipeWire                  | (new)      | https://kodi.wiki/view/PipeWire
       no-op    | Advanced Settings        | 4002       | https://kodi.wiki/view/Advanced_Settings
       ```
   - Retrofit-preview is a distinct mode from `--dry-run` — both can be set together but retrofit-preview overrides dry-run for the GitHub scanning part (the publisher handles this).

3. Add tests to `src/knowledge/wiki-publisher.test.ts` (retrofit-preview contract):
   - **Update path**: Mock `listComments` returning `[{ id: 7001, body: "<!-- kodiai:wiki-modification:42 -->\n## Test..." }]` for issue scan. Call `publish({ retrofitPreview: true, issueNumber: 50 })` with a mock DB group for pageId 42. Assert result has `retrofitPreviewResult.actions[0].action === 'update'` and `existingCommentId === 7001`.
   - **Create path**: Mock `listComments` returning `[]`. Assert `actions[0].action === 'create'` and `existingCommentId === null`.
   - **No mutation**: Assert mock Octokit's `createComment` and `updateComment` are never called during retrofit-preview.

4. TypeScript check: `bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types|publish-wiki'` must produce no output.

## Must-Haves

- [ ] `retrofitPreview` branch in `publish()` scans GitHub and returns `RetrofitPreviewResult` without calling `createComment` or `updateComment`
- [ ] `--retrofit-preview` and `--issue-number` CLI flags exist and are documented in `--help`
- [ ] CLI prints action table when `--retrofit-preview` is set
- [ ] `retrofitPreviewResult` field added to `PublishResult`
- [ ] Publisher tests cover update-path, create-path, and no-mutation contract for retrofit-preview
- [ ] TypeScript clean on all touched files

## Verification

- `bun test src/knowledge/wiki-publisher.test.ts` — all tests pass (prior 33 + 3 new retrofit-preview tests = 36+)
- `bun scripts/publish-wiki-updates.ts --help | grep -q 'retrofit-preview'`
- `bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types|publish-wiki'` → no output

## Observability Impact

- Signals added/changed: `logger.info({ pageId, pageTitle, action, existingCommentId })` per planned action from retrofit-preview path
- How a future agent inspects this: run `bun scripts/publish-wiki-updates.ts --retrofit-preview --issue-number N` and read the printed table; also available in `PublishResult.retrofitPreviewResult`
- Failure state exposed: missing `--issue-number` with `--retrofit-preview` exits with a clear error message

## Inputs

- T01 output: `upsertWikiPageComment`, `RetrofitPageAction`, `RetrofitPreviewResult`, `issueNumber` + `retrofitPreview` fields on `PublishRunOptions` in `wiki-publisher-types.ts`
- `src/knowledge/wiki-publisher.ts` — existing `publish()` method and DB group-fetching query
- `src/knowledge/wiki-publisher-types.ts` — `PublishResult` type to extend with `retrofitPreviewResult`
- `scripts/publish-wiki-updates.ts` — existing arg parsing, help text, and invocation of `publisher.publish()`

## Expected Output

- `src/knowledge/wiki-publisher.ts` — `retrofitPreview` branch in `publish()`, no-mutation contract, info logging
- `src/knowledge/wiki-publisher-types.ts` — `retrofitPreviewResult?: RetrofitPreviewResult` on `PublishResult`
- `src/knowledge/wiki-publisher.test.ts` — 3 new retrofit-preview tests; all 36+ pass
- `scripts/publish-wiki-updates.ts` — `--retrofit-preview` and `--issue-number` flags; action table printer
