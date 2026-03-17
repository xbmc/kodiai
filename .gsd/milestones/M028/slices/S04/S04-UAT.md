# S04: Final Integrated Publication & Retrofit Proof — UAT

**Milestone:** M028
**Written:** 2026-03-16

## UAT Type

- UAT mode: artifact-driven + live-runtime
- Why this mode is sufficient: All R025–R029 checks are machine-verifiable via structured JSON output from the `verify:m028:s04` harness and the publisher test suite. No human interpretation of GitHub comment aesthetics is required — the harness checks both pure-code contract and live DB state. The sentinel re-publish was performed as part of T02 execution and is confirmed by SENTINEL-SUPERSEDED=pass.

## Preconditions

1. `DATABASE_URL` is set and points to the Kodiai Postgres instance with the `wiki_update_suggestions` table (migration 031 applied, `published_comment_id` column present).
2. `bun install` has been run in `/home/keith/src/kodiai`.
3. The prior slices (S01–S03) are complete: `wiki-publisher.ts` has `formatPageComment` without `**Why:**`/`:warning:`, `published_comment_id` column exists, 80+ rows have real comment IDs from S03 live publish.
4. No pending un-applied migrations that would break the DB connection.

## Smoke Test

```bash
bun run verify:m028:s04 --json 2>&1 | grep overallPassed
```
**Expected:** `"overallPassed": true`

---

## Test Cases

### 1. `formatSummaryTable` emits modification-only labels

```bash
bun -e "import {formatSummaryTable} from './src/knowledge/wiki-publisher.ts'; console.log(formatSummaryTable('2026-03-05', [], 0))"
```

1. Run the command above.
2. **Expected:** Output contains `# Wiki Modification Artifacts — 2026-03-05`.
3. **Expected:** Output contains `**Modifications posted:** 0`.
4. **Expected:** Output does NOT contain `Wiki Update Suggestions`, `Suggestions posted`, `Voice Warnings`, `WHY:`, or `:warning:`.

---

### 2. Publisher test suite passes with negative guards

```bash
bun test src/knowledge/wiki-publisher.test.ts
```

1. Run the test suite.
2. **Expected:** `39 pass, 0 fail`.
3. **Expected:** The test named `"does not contain suggestion-style labels"` is present and passing.
4. **Expected:** The test named `"does not render voice warning column"` is present and passing.

---

### 3. S04 proof harness test suite passes

```bash
bun test ./scripts/verify-m028-s04.test.ts
```

1. Run the test suite.
2. **Expected:** `48 pass, 0 fail`.
3. **Expected:** The test `"SENTINEL-SUPERSEDED is NOT excluded from overallPassed gate"` passes — this confirms the sentinel check is a real gate, not informational.
4. **Expected:** Pure-code checks (NO-WHY-IN-RENDER, NO-WHY-IN-SUMMARY, DRY-RUN-CLEAN) never report `skipped: true` even without DB.

---

### 4. S04 verifier: all 5 checks pass with `overallPassed: true`

```bash
bun run verify:m028:s04 --json
```

1. Run the verifier.
2. **Expected:** `"overallPassed": true`.
3. **Expected:** `M028-S04-NO-WHY-IN-RENDER` → `"passed": true`, `"skipped": false`.
4. **Expected:** `M028-S04-NO-WHY-IN-SUMMARY` → `"passed": true`, `"skipped": false`.
5. **Expected:** `M028-S04-LIVE-PUBLISHED` → `"passed": true`, `"detail"` shows `count=104` (or ≥ 80).
6. **Expected:** `M028-S04-SENTINEL-SUPERSEDED` → `"passed": true`, `"detail"` shows `sentinel_rows=0`.
7. **Expected:** `M028-S04-DRY-RUN-CLEAN` → `"passed": true`, `"skipped": false`.

---

### 5. Full regression sweep: S02 + S03 + S04 all exit 0

```bash
bun run verify:m028:s02 --json && bun run verify:m028:s03 --json && bun run verify:m028:s04 --json
```

1. Run the full sweep.
2. **Expected:** Command exits 0 (no failure) and all three scripts output `"overallPassed": true`.
3. **Expected:** `verify:m028:s02` — `COMMENT-MARKER`, `UPSERT-CONTRACT`, `COMMENT-ID-SCHEMA`, `PUBLISHED-LINKAGE` all pass.
4. **Expected:** `verify:m028:s03` — `NO-WHY-IN-RENDER`, `LIVE-MARKER`, `SENTINEL-CLEARED` all pass (COMMENT-BODY may skip if GitHub unavailable — this is expected).
5. **Expected:** `verify:m028:s04` — all 5 checks pass as above.

---

### 6. SENTINEL-SUPERSEDED gate blocks `overallPassed` when sentinel rows exist

This is a unit-level proof, verified by the test suite (not requiring DB state manipulation):

```bash
bun test ./scripts/verify-m028-s04.test.ts --reporter=verbose 2>&1 | grep "SENTINEL-SUPERSEDED is NOT excluded"
```

1. Run the command.
2. **Expected:** Line appears as `(pass)` indicating the test is present and passing.

Alternatively, run the full test output and confirm the test `"overallPassed is false when SENTINEL-SUPERSEDED fails (count=21)"` is in the passing output.

---

### 7. Type check: no errors in S04 files

```bash
bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|verify-m028-s04'
```

1. Run the type check.
2. **Expected:** No output (no type errors in these files).

---

## Edge Cases

### SENTINEL-SUPERSEDED detail string on failure

If for any reason sentinel rows re-appear (e.g., a new publish run that sets `published_comment_id = 0`):

```bash
bun run verify:m028:s04 --json 2>&1 | jq '.checks[] | select(.id == "M028-S04-SENTINEL-SUPERSEDED")'
```

**Expected on failure:** `detail` field shows `sentinel_rows=N (need 0; run re-publish to supersede)` — not a generic error message.

---

### DB-unavailable graceful skip

```bash
DATABASE_URL="" bun run verify:m028:s04 --json 2>&1 | jq '{overall: .overallPassed, db_checks: [.checks[] | select(.id | startswith("M028-S04-LIVE") or startswith("M028-S04-SENTINEL"))]}'
```

**Expected:** DB-gated checks (`LIVE-PUBLISHED`, `SENTINEL-SUPERSEDED`) show `"skipped": true`; pure-code checks still pass; `overallPassed` is `true` (skipped checks don't block it).

---

### Negative guard regression detection

To confirm the negative guards actually catch regressions, the publisher test suite is authoritative:

```bash
bun test src/knowledge/wiki-publisher.test.ts --reporter=verbose 2>&1 | grep -E 'not contain suggestion|not render voice'
```

**Expected:** Both lines appear as `(pass)`.

---

## Failure Signals

- `"overallPassed": false` in `bun run verify:m028:s04 --json` → inspect `jq '.checks[] | select(.passed == false)'` for failing check detail.
- `SENTINEL-SUPERSEDED` failing with `sentinel_rows=N` → N rows remain with `published_comment_id = 0`; re-run the sentinel publish step.
- `LIVE-PUBLISHED` failing with `count=N` → fewer than 80 published rows in DB; check DB connectivity or whether rows were deleted.
- Publisher test failures naming `Wiki Update Suggestions`, `Suggestions posted`, or `Voice Warnings` → a regression in `formatSummaryTable`; check recent changes to `wiki-publisher.ts`.
- Publisher test failures naming `**Why:**` or `:warning:` → a regression in `formatPageComment` or `formatSummaryTable`; check recent changes to `wiki-publisher.ts`.
- Non-zero exit from regression sweep → check which verifier failed and inspect its `checks` output for the failing check's `detail` field.

## Requirements Proved By This UAT

- R025 — Pure-code checks NO-WHY-IN-RENDER, NO-WHY-IN-SUMMARY, DRY-RUN-CLEAN prove the modification-only artifact contract holds in all publisher output paths
- R026 — LIVE-PUBLISHED (count=104) proves 104 comments with real IDs exist; DRY-RUN-CLEAN proves no **Why:** or :warning: in rendered output
- R027 — Section/page mode is tested in `formatPageComment` mocks; artifact envelope carries explicit mode metadata
- R028 — SENTINEL-SUPERSEDED=pass (sentinel_rows=0) proves all 21 legacy rows acquired real GitHub comment IDs via live upsert
- R029 — 5-check harness + 39-test publisher suite (with 5 negative guards) provides machine-verifiable regression protection

## Not Proven By This UAT

- Live GitHub comment body content review — `M028-S03-COMMENT-BODY` check skips when GitHub credentials are unavailable in the test environment; the S03 live publish (3 comments to issue #5) was the authoritative live proof for R026 comment formatting.
- Generation pipeline (wiki-update-generator.ts) modification-only contract — proven in S01; S04 verifies the publisher/render layer only.
- Future publish runs with new wiki content — the harness proves the current DB state and publisher contract; new generation cycles would need to be run to confirm new artifacts also satisfy the contract.

## Notes for Tester

- The sentinel re-publish was already performed in T02. SENTINEL-SUPERSEDED should already be passing — no additional operational steps are needed to run this UAT.
- `M028-S03-COMMENT-BODY` in the S03 verifier is expected to show `"skipped": true` when run in a DB-only environment (no GitHub App credentials). This is normal and does not indicate a failure.
- The LIVE-PUBLISHED threshold is 80; after the sentinel re-publish, count is 104. Any DB query confirming this: `SELECT COUNT(*) FROM wiki_update_suggestions WHERE published_comment_id > 0`.
- If running verify:m028:s02 produces failures on PUBLISHED-LINKAGE, check that no rows have `published_at IS NOT NULL` with `published_comment_id IS NULL` (different from 0 — the migration may not have backfilled NULL rows).
