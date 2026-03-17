# M028 / S04 — Research

**Date:** 2026-03-16

## Summary

S04 is a final integrated acceptance slice. Its primary job is to aggregate the M028 contract across all previous slices into a single proof harness, fix the remaining surface-level inconsistencies in `formatSummaryTable`, publish the 21 sentinel-row pages through the upsert path to clear old suggestion-style comments from issue #5, and confirm that all regression guards hold together.

The codebase is in a well-defined state. S02 and S03 deliverables are real and passing: `upsertWikiPageComment`, identity markers, `published_comment_id` column, live publish to xbmc/wiki issue #5, and `verify-m028-s03.ts` all work. The S01 "artifact type contract migration" (migration 030, `modification_mode`/`replacement_content` columns, `parseModificationContent`, `pageModeThreshold`) was claimed in task summaries but never implemented — no migration 030 exists, the DB has only `suggestion`/`why_summary` columns, and `wiki-update-types.ts` has no `modificationMode` field. The functional pipeline still works because the `suggestion` column holds the LLM-generated replacement text (verified: no `WHY:` in the stored `suggestion` column), `formatPageComment` renders it clean (S03 fixed the `**Why:**` regression), and upsert publishing is live.

One non-trivial residual regression: `formatSummaryTable` still emits `# Wiki Update Suggestions` as its issue body title, `**Suggestions posted:**` as the stat label, and a "Voice Warnings" column in the table — all inconsistent with the modification-only contract. The issue title is separate (`Wiki Modification Artifacts — {date}` is already correct in `publish()`), but the issue body summary written by `formatSummaryTable` still has the old labels. This is a surface-only fix — no DB or type changes required.

**Recommendation:** S04 has two tasks. T01 fixes `formatSummaryTable` and adds regression tests for it. T02 writes `verify-m028-s04.ts` — an integrated proof harness with 5 checks covering the full R025–R029 contract — and publishes the sentinel rows through the upsert path to supersede the old suggestion-style comments on issue #5.

## Recommendation

Fix `formatSummaryTable` first (T01) because it is the last publisher surface that still says "suggestions" instead of "modifications." Then write the S04 verifier (T02) that aggregates the full contract. The sentinel-row re-publish (21 pages) belongs in T02 as an operational step verified by the harness, not a separate task — it is a `bun scripts/publish-wiki-updates.ts --issue-number 5 --page-ids <ids>` run that exercises the already-proven upsert path.

Do not attempt to implement the S01 artifact type contract (migration 030, `modification_mode` column, `parseModificationContent`) in S04. That work is foundational and was not delivered by S01. Attempting it in the acceptance slice would expand scope significantly and risk destabilizing the working S02/S03 infrastructure. The functional contract for R025 is satisfied by the absence of `WHY:` in stored `suggestion` values and in rendered `formatPageComment` output. R029 regression guards should lock that fact without requiring the field-renaming work that S01 was supposed to deliver.

## Implementation Landscape

### Key Files

- `src/knowledge/wiki-publisher.ts` — `formatSummaryTable` (lines 69–112) still has old "Wiki Update Suggestions" title and "Voice Warnings" column. Fix: rename title to `Wiki Modification Artifacts`, rename stat to `Modifications posted`, remove Voice Warnings column from table header and rows. `formatPageComment` is clean (no `**Why:**`; verified by `verify-m028-s03.ts`).

- `src/knowledge/wiki-publisher.test.ts` — two assertions guard the old `formatSummaryTable` labels: line 215 checks `"# Wiki Update Suggestions — 2026-03-05"` and line 240 checks `"**Suggestions posted:** 4"`. Both must be updated. Add a new negative guard: `expect(result).not.toContain("WHY:")` and `expect(result).not.toContain(":warning:")` on `formatSummaryTable` output.

- `scripts/verify-m028-s04.ts` — new file. Aggregated 5-check proof harness:
  - `M028-S04-NO-WHY-IN-RENDER` (pure-code) — `formatPageComment` clean; reuse `checkNoWhyInRender` logic from `verify-m028-s03.ts`
  - `M028-S04-NO-WHY-IN-SUMMARY` (pure-code) — `formatSummaryTable` output contains neither `**Why:**`, `:warning:`, nor `"Wiki Update Suggestions"`
  - `M028-S04-LIVE-PUBLISHED` (DB-gated) — `COUNT(*) WHERE published_comment_id > 0` passes when count ≥ 80
  - `M028-S04-SENTINEL-SUPERSEDED` (DB-gated) — `COUNT(*) WHERE published_comment_id = 0 AND published_at IS NOT NULL` should be 0 after the sentinel re-publish run; passes when count = 0
  - `M028-S04-DRY-RUN-CLEAN` (pure-code) — dry-run path of `publish()` (exercised via mock) returns output with no `**Why:**`; this re-proves the render contract from the top of the call stack

- `scripts/verify-m028-s04.test.ts` — new file. ~30 tests covering check IDs, envelope shape, pure-code pass/fail paths, DB-gated skip behavior, and `overallPassed` semantics. Follow `verify-m028-s03.test.ts` exactly as the template.

- `package.json` — add `"verify:m028:s04": "bun scripts/verify-m028-s04.ts"`.

### Build Order

1. **T01 — Fix `formatSummaryTable` and update tests** — before the S04 verifier, because `M028-S04-NO-WHY-IN-SUMMARY` checks the corrected output. Small change: rename title string and stat label, drop Voice Warnings column from table header and row format string, update two test assertions, add negative guards.

2. **T02 — S04 proof harness + sentinel re-publish** — write `verify-m028-s04.ts` following the S02/S03 harness template exactly. Implement five checks. Run `bun run verify:m028:s04 --json` to baseline all checks (LIVE-PUBLISHED should already pass with count=80; SENTINEL-SUPERSEDED will fail with count=21 until the re-publish run). Then execute the sentinel re-publish: `bun scripts/publish-wiki-updates.ts --issue-number 5` (no `--page-ids` — targets the 3 genuinely unpublished rows, and the upsert logic handles already-published rows idempotently). After re-publish, verify SENTINEL-SUPERSEDED passes.

   Note on sentinel rows: the publisher's publish loop queries `WHERE published_at IS NULL`. The 21 sentinel rows have `published_at IS NOT NULL`, so the standard publish run does NOT re-publish them. To supersede sentinel rows, the S04 re-publish must either: (a) explicitly provide `--page-ids` for the sentinel page IDs, or (b) reset sentinel `published_at` to NULL first. Check which approach the upsert path supports — `upsertWikiPageComment` handles the GitHub side correctly, but the DB UPDATE that marks published only runs `WHERE published_at IS NULL`. The simplest correct approach: gather the 21 sentinel page_ids and pass them as `--page-ids` in combination with a direct DB update to set `published_at = NULL` for those rows before re-publishing. Document this as the sentinel supersession procedure.

### Verification Approach

```bash
# T01 — Confirm formatSummaryTable fix:
bun test src/knowledge/wiki-publisher.test.ts
# → 38+ pass, 0 fail; "Wiki Modification Artifacts" in summary title

# T02 — Run verifier before sentinel re-publish:
bun run verify:m028:s04 --json
# Expected: LIVE-PUBLISHED=pass(count>=80), SENTINEL-SUPERSEDED=fail(count=21)

# T02 — Sentinel re-publish (sentinel page_ids, after resetting published_at):
bun scripts/publish-wiki-updates.ts --issue-number 5 --page-ids <sentinel-ids>
# → 21 pages upserted to issue #5 with real comment IDs

# T02 — Run verifier after re-publish:
bun run verify:m028:s04 --json
# Expected: overallPassed=true, SENTINEL-SUPERSEDED=pass(count=0)

# T02 — Verifier test suite:
bun test ./scripts/verify-m028-s04.test.ts
# → 30+ pass, 0 fail

# Final regression sweep:
bun run verify:m028:s02 --json && bun run verify:m028:s03 --json && bun run verify:m028:s04 --json
# → all three overallPassed=true

bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|verify-m028'
# → (no output)
```

## Constraints

- The publisher `publish()` loop queries `WHERE published_at IS NULL` for unpublished rows. Sentinel rows have `published_at IS NOT NULL`, so a plain `--issue-number 5` run will NOT touch them. Re-publishing sentinel rows requires either resetting `published_at = NULL` or explicit `--page-ids` targeting. The correct approach for S04 is a single-run SQL reset + publish so the upsert path updates the GitHub comments and writes real comment IDs.

- `upsertWikiPageComment` scans per `pageId` marker, so passing the same page IDs a second time correctly UPDATEs the existing comment rather than creating duplicates. The idempotency contract is proven.

- Do NOT add `--page-ids` scoping for the 3 genuinely unpublished rows — they are already filtered by the `published_at IS NULL` condition in the standard publish query and will be included automatically.

- `M028-S04-DRY-RUN-CLEAN` cannot call the real `publish()` with a live DB + GitHub App (too slow, needs credentials). Instead, exercise it by calling `formatPageComment` on a minimal mock group directly — same as the existing `checkNoWhyInRender` pattern. Alternatively, reuse the check function from `verify-m028-s03.ts` rather than duplicating it.

## Common Pitfalls

- **Forgetting that sentinel rows have `published_at IS NOT NULL`** — the standard publish run ignores them. The S04 operational step explicitly resets these rows before re-publishing, then verifies `SENTINEL-SUPERSEDED` passes (count=0).

- **`formatSummaryTable` fix breaking the issue body column layout** — when dropping the "Voice Warnings" column, update both the header row AND every data row in the loop. The existing test at line 238 checks the voice warnings column; this test must be updated or the negative assertion added.

- **`overallPassed` semantics for the integrated harness** — keep SENTINEL-SUPERSEDED as a real failing check (not informational), since the milestone is only complete when those 21 rows are superseded. Do not mark it informational the way S03 treated SENTINEL-CLEARED.

- **Importing from S02/S03 verifier modules** — if S04 re-uses individual check functions from prior verifiers, import them directly. Avoid copy-paste drift. If the import creates a circular dependency or coupling concern, inline the minimal logic instead.

## Open Risks

- The sentinel re-publish (resetting `published_at = NULL` on 21 rows) is a direct DB mutation before the publish run. If the publish run fails mid-way, some sentinel rows will have `published_at = NULL` and no real comment ID, leaving them partially migrated. The upsert path handles GitHub correctly; the risk is the DB state between reset and completion. Acceptable for S04 — this is a known operational one-time migration with a machine-checkable end state.

- `SENTINEL-SUPERSEDED` check passes when count=0. If the sentinel re-publish writes `published_comment_id > 0` for all 21 rows, the check passes and the DB query confirms supersession. This is the correct end state.
