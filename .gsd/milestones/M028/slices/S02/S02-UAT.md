# S02: Deterministic Retrofit & Comment Identity Surface — UAT

**Milestone:** M028
**Written:** 2026-03-16

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: All S02 surfaces are machine-checkable — the proof harness covers the marker contract and upsert contract with mocks, the DB schema check is DB-gated, and the CLI flag is inspectable without GitHub credentials. Live GitHub mutation is out of scope for S02 (deferred to S03). No human-experience UAT is needed.

## Preconditions

- Working directory: `/home/keith/src/kodiai`
- `bun` available
- `DATABASE_URL` set (required for DB-gated checks; DB-gated checks skip cleanly if absent — skip-is-pass for those two)
- Migration 031 applied to the target DB (`src/db/migrations/031-wiki-comment-identity.sql`)
- Legacy published rows have been backfilled (`published_comment_id = 0` for rows with `published_at IS NOT NULL AND published_comment_id IS NULL`)

## Smoke Test

```bash
bun run verify:m028:s02 --json | jq '.overallPassed'
# → true
```

This single command confirms the marker contract, upsert contract, DB schema, and published-row linkage are all passing.

## Test Cases

### 1. Verifier exits 0 with overallPassed: true

1. Run `bun run verify:m028:s02 --json`
2. **Expected:** Exit code 0; JSON output includes `"overallPassed": true`; `.checks` array has exactly 4 entries with IDs `M028-S02-COMMENT-MARKER`, `M028-S02-UPSERT-CONTRACT`, `M028-S02-COMMENT-ID-SCHEMA`, `M028-S02-PUBLISHED-LINKAGE`

### 2. All four check status codes are correct on happy path

1. Run `bun run verify:m028:s02 --json | jq '.checks[].status_code'`
2. **Expected:** Four values in order: `"marker_present"`, `"upsert_contract_ok"`, `"schema_ok"`, `"no_linkage_gap"`

### 3. HTML identity marker is first line of every formatPageComment output

1. Run:
   ```bash
   bun -e "
     import { formatPageComment } from './src/knowledge/wiki-publisher.ts';
     const out = formatPageComment({ pageId: 42, pageTitle: 'Test Page', modificationMode: 'section', suggestions: [] }, 'xbmc', 'xbmc');
     console.log(out.split('\n')[0]);
   "
   ```
2. **Expected:** First line is exactly `<!-- kodiai:wiki-modification:42 -->`

### 4. Marker contains the correct pageId

1. Run:
   ```bash
   bun -e "
     import { formatPageComment } from './src/knowledge/wiki-publisher.ts';
     const out = formatPageComment({ pageId: 99, pageTitle: 'Other Page', modificationMode: 'page', suggestions: [] }, 'xbmc', 'xbmc');
     console.log(out.includes('kodiai:wiki-modification:99'));
   "
   ```
2. **Expected:** Output is `true`

### 5. Marker does not break S01 content guards

1. Run:
   ```bash
   bun -e "
     import { formatPageComment } from './src/knowledge/wiki-publisher.ts';
     const out = formatPageComment({ pageId: 1, pageTitle: 'Test', modificationMode: 'section', suggestions: [] }, 'xbmc', 'xbmc');
     console.log('why:', out.includes('**Why:**'));
     console.log('warning:', out.includes(':warning:'));
   "
   ```
2. **Expected:** Both lines print `false`

### 6. wiki-publisher test suite — all 37 tests pass

1. Run `bun test src/knowledge/wiki-publisher.test.ts`
2. **Expected:** `37 pass, 0 fail`; test groups include `formatPageComment — comment identity marker` (5 tests) and `createWikiPublisher — retrofitPreview` (3 tests)

### 7. Verifier test suite — all 34 tests pass

1. Run `bun test ./scripts/verify-m028-s02.test.ts`
2. **Expected:** `34 pass, 0 fail`; groups include `Check ID contract`, `Envelope shape`, `COMMENT-MARKER check`, `UPSERT-CONTRACT check`, `DB-gated checks — no DB available`, `DB-gated checks — DB available`, `overallPassed semantics`, `All check IDs present even when DB skipped`

### 8. DB schema — published_comment_id column exists

1. Run `bun run verify:m028:s02 --json | jq '.checks[] | select(.id == "M028-S02-COMMENT-ID-SCHEMA")'`
2. **Expected:** `"passed": true`, `"skipped": false`, `"status_code": "schema_ok"`, detail mentions `published_comment_id column present`

### 9. Published-row linkage — no gap

1. Run `bun run verify:m028:s02 --json | jq '.checks[] | select(.id == "M028-S02-PUBLISHED-LINKAGE")'`
2. **Expected:** `"passed": true`, `"skipped": false`, `"status_code": "no_linkage_gap"`, detail mentions `no published rows missing published_comment_id`

### 10. CLI --help shows --retrofit-preview flag

1. Run `bun scripts/publish-wiki-updates.ts --help`
2. **Expected:** Output contains `--retrofit-preview` and `--issue-number`; help text explains the flag reads GitHub without posting

### 11. CLI enforces --issue-number requirement

1. Run `bun scripts/publish-wiki-updates.ts --retrofit-preview 2>&1`
2. **Expected:** Exits non-zero; stderr/stdout contains `Error: --retrofit-preview requires --issue-number <n>`

### 12. upsertWikiPageComment update path

1. Run `bun test src/knowledge/wiki-publisher.test.ts --test "calls updateComment when marker found"`
2. **Expected:** Test passes; confirms `updateComment` was called and `createComment` was not

### 13. upsertWikiPageComment create path

1. Run `bun test src/knowledge/wiki-publisher.test.ts --test "calls createComment when no marker found"`
2. **Expected:** Test passes; confirms `createComment` was called and `updateComment` was not

### 14. retrofitPreview — no mutation

1. Run `bun test src/knowledge/wiki-publisher.test.ts --test "no-mutation"`
2. **Expected:** Test passes; confirms neither `createComment` nor `updateComment` was called during retrofit-preview

### 15. TypeScript clean on all S02 target files

1. Run `bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types|verify-m028-s02|publish-wiki'`
2. **Expected:** No output (zero TypeScript errors on S02 files)

### 16. Migration files exist and are well-formed

1. Run:
   ```bash
   cat src/db/migrations/031-wiki-comment-identity.sql
   cat src/db/migrations/031-wiki-comment-identity.down.sql
   ```
2. **Expected:** Up migration contains `ADD COLUMN published_comment_id BIGINT`; down migration contains `DROP COLUMN IF EXISTS published_comment_id`

## Edge Cases

### DB unavailable — checks skip, not fail

1. Run `DATABASE_URL="" bun run verify:m028:s02 --json | jq '.checks[] | select(.skipped == true)'`
2. **Expected:** Two entries: `M028-S02-COMMENT-ID-SCHEMA` and `M028-S02-PUBLISHED-LINKAGE` both skipped with `status_code: "db_unavailable"`; `overallPassed` still true (skips are non-failures)

### DB unavailable — pure-code checks still pass

1. Run `DATABASE_URL="" bun run verify:m028:s02 --json | jq '.checks[] | select(.skipped == false)'`
2. **Expected:** `M028-S02-COMMENT-MARKER` and `M028-S02-UPSERT-CONTRACT` both pass with `skipped: false`

### Failing check returns structured detail

1. Run `bun run verify:m028:s02 --json | jq '.checks[] | select(.passed == false)'`
2. **Expected:** Empty array (all checks pass in a correctly configured environment); if a check fails, each entry has `.status_code` and `.detail` fields explaining the failure

### Scan-throw fallthrough in upsertWikiPageComment

1. Run `bun test src/knowledge/wiki-publisher.test.ts --test "falls through to createComment when scan throws"`
2. **Expected:** Test passes; confirms that if `listComments` throws during scan, the function falls through to `createComment` rather than aborting

## Failure Signals

- `bun run verify:m028:s02 --json` exits 1 or `overallPassed: false` — a check failed; inspect `.checks[] | select(.passed == false)` for `.status_code` and `.detail`
- `status_code: "column_missing"` in `M028-S02-COMMENT-ID-SCHEMA` — migration 031 has not been applied; run the SQL file against the target DB
- `status_code: "linkage_gap_found"` in `M028-S02-PUBLISHED-LINKAGE` — published rows exist with NULL `published_comment_id`; backfill with `UPDATE wiki_update_suggestions SET published_comment_id = 0 WHERE published_at IS NOT NULL AND published_comment_id IS NULL`
- `marker_absent` in `M028-S02-COMMENT-MARKER` — `formatPageComment()` was changed and no longer prepends the marker; check for recent edits to `wiki-publisher.ts`
- TypeScript errors on target files — type contract broken; check `wiki-publisher-types.ts` for missing/changed type fields

## Requirements Proved By This UAT

- **R028** — Existing published wiki suggestion comments can be retrofitted or superseded: stable comment identity (marker + DB linkage), scan-based upsert, and retrofit-preview path are all verified; live GitHub write behavior is delegated to S03

## Not Proven By This UAT

- Live GitHub comment creation/update against the real `xbmc/wiki` tracking issue (S03 scope)
- Actual supersession of historical suggestion-style comments in the live thread (S03 scope)
- End-to-end regression guard across the full publication pipeline (S04 scope)
- Behavior of `--retrofit-preview` against a real issue with many pages of comments

## Notes for Tester

- The DB-gated checks (`M028-S02-COMMENT-ID-SCHEMA` and `M028-S02-PUBLISHED-LINKAGE`) require `DATABASE_URL` to be set. If absent, both skip with `db_unavailable` — this is not a failure. For full verification, run with a Postgres connection that has migration 031 applied.
- The 21 legacy backfilled rows (`published_comment_id=0`) will appear in DB queries as non-NULL. This is intentional — 0 is the sentinel for "published before comment identity tracking." Real upsert-path writes will have positive comment IDs (>0).
- `--retrofit-preview` requires real GitHub App credentials (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`) even though it doesn't write to GitHub. Without credentials, the CLI will fail at the pre-flight GitHub App check. This is by design; the flag is for operators with access, not offline/dry-run use.
- All 71 tests (37 publisher + 34 verifier) must pass. The publisher test suite covers both the marker and upsert/retrofit contracts; the verifier test suite covers the proof harness behavior independently.
