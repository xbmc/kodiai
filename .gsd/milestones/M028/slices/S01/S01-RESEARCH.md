# S01: Modification Artifact Contract Through Real Entry Points — Research

**Date:** 2026-03-11
**Slice:** M028/S01
**Requirements owned/supported:** R025 (primary), R026 (support), R027 (primary), R029 (support)

## Summary

The wiki pipeline has a suggestion-shaped contract at every storage and rendering layer, but the LLM call itself already produces modification-only text. The key discovery from reading the actual code: `buildGroundedSectionPrompt` — the function with the `WHY:` instruction — is **not called in the production main path**. It is only imported and tested in `wiki-update-generator.test.ts`. The actual generation path uses `createVoicePreservingPipeline` → `buildVoicePreservingPrompt`, which outputs pure wiki replacement content.

The `WHY:` contract violation therefore lives entirely in the post-generation layers: `parseGeneratedSuggestion(vr.suggestion)` at line 570 carves a fake `whySummary` out of the voice pipeline's modification text (using a sentence-boundary fallback since there is no `WHY:` prefix), `storeSuggestion` writes that fake `why_summary` to the DB, and `formatPageComment` reads it and renders `**Why:** {whySummary}`. The prompt change needed is minimal — just retire the tested-but-unused `buildGroundedSectionPrompt` function and its associated tests. The real work is in parser, storage types/schema, and renderer.

The second main complexity is hybrid granularity. The current schema has no first-class `modification_mode` field. The unique index is `(page_id, COALESCE(section_heading, ''))`, so a full-page artifact (with `sectionHeading = null`) would collide with a lead-section artifact. The fix requires adding `modification_mode TEXT NOT NULL` to both the schema and the unique index, and implementing a deterministic mode-selection rule (count of sections with patch matches) before processing each page.

Primary recommendation: change parser + types/schema + renderer in one coordinated pass, add `modification_mode` + `replacement_content` as first-class fields, prove the contract with a JSON-first verifier (following the M027 pattern) against dry-run output and fresh DB rows, and do not touch live GitHub until the dry-run output is confirmed modification-only.

## Recommendation

### Approach

Execute as four coordinated sub-units:

**1. New artifact types + DB migration**

Add a new migration (`030-wiki-modification-artifacts.sql`) that:
- Adds `modification_mode TEXT NOT NULL DEFAULT 'section' CHECK (modification_mode IN ('section', 'page'))`
- Adds `replacement_content TEXT` — the concrete modification text; separate from legacy `suggestion`
- Makes `why_summary` nullable (remove `NOT NULL` constraint)
- Drops `idx_wiki_update_suggestions_page_section` and creates a new unique index:
  `UNIQUE (page_id, modification_mode, COALESCE(section_heading, ''))`

The new index allows section-mode rows and one page-mode row to coexist without collision, and makes mode machine-checkable via SQL without string heuristics.

Update `UpdateSuggestion` in `wiki-update-types.ts`:
- Add `modificationMode: 'section' | 'page'`
- Add `replacementContent: string`
- Make `whySummary: string | null` (nullable for forward compat)

Update `UpdateGeneratorResult`:
- Add `modificationsGenerated` and `modificationsDropped` fields (or rename existing `suggestionsGenerated`/`suggestionsDropped` — see Pitfalls)

**2. Generator: parser + storage changes (no prompt change needed for main path)**

`buildGroundedSectionPrompt` is tested-only and not in the production call stack. Leave it in place for now (it will be superseded by the new contract tests), or mark it `@deprecated` — do not remove in S01, since it is referenced by existing tests that will be rewritten anyway.

Replace `parseGeneratedSuggestion()` (which tries to extract `WHY:`) with `parseModificationContent()`:
```typescript
export function parseModificationContent(text: string): {
  replacementContent: string;
  isNoUpdate: boolean;
}
```
Returns `{ replacementContent: text.trim(), isNoUpdate: false }` unless the text starts with `NO_UPDATE`. No `whySummary` extraction.

Add a deterministic mode-selection rule at the top of `processPage()`:
- Count `sectionInputs.length` before processing starts
- If `>= pageModeThreshold` (default: 3, exposed as an `UpdateGeneratorOptions` field), set `pageMode = 'page'`
- For `section` mode (default): generate one row per section as today
- For `page` mode: after generating all section voice-pipeline results, stitch them in section order into a single `replacementContent` string, use `sectionHeading = null` and `modificationMode = 'page'`, and delete all existing rows for the page before inserting the single page-mode row

Update `storeSuggestion()` to write `replacement_content` and `modification_mode`. For page-mode artifacts, the DELETE clause must match on `modification_mode` OR unconditionally clear all rows for the page (since we're replacing them all).

**3. Publisher: modification-only renderer**

Update `PageSuggestionGroup` in `wiki-publisher-types.ts`:
- Replace `whySummary: string` with `replacementContent: string` in the per-suggestion shape
- Add `modificationMode: 'section' | 'page'` to the group type

Update the DB SELECT in `wiki-publisher.ts` to fetch `replacement_content` and `modification_mode` instead of (or alongside) `why_summary`. For backward compat with old rows: fall back to `suggestion` when `replacement_content` is null.

Rewrite `formatPageComment()`:
- Remove `lines.push("", `**Why:** ${s.whySummary}`)` (line 46)
- Remove voice mismatch warning prose from the rendered output (keep `voiceMismatchWarning` on the type for internal tracking, do not render it in published comments)
- For page-mode: skip per-section headers; render the single `replacementContent` block directly
- For section-mode: keep per-section `### Heading` headers and inline content
- Keep PR citation links — they are the minimal metadata that lets operators trace modifications back to source

Also update `formatSummaryTable()`:
- Replace "Suggestions" language with "Modifications" in column headers and counts
- Remove "Voice Warnings" column if voice warnings are now internal-only

**4. Tests + verifier**

Rewrite existing test contracts:
- `wiki-update-generator.test.ts`: rewrite `buildGroundedSectionPrompt` tests to either test the new modification prompt (if one exists) or replace with `parseModificationContent` tests. Key assertions: `NO_UPDATE` still recognized, replacement content returned as-is, no `whySummary` extraction. Add mode-selection tests: `modificationMode='section'` below threshold, `'page'` at/above threshold.
- `wiki-publisher.test.ts`: fix `makeGroup()` helper to use `replacementContent` instead of `whySummary`. `formatPageComment` tests must include `expect(result).not.toContain("**Why:**")` as a negative regression guard. Drop voice-mismatch-in-output tests (internal only now).

Add `scripts/verify-m028-s01.ts` following the M027 pattern (stable check IDs, raw evidence, JSON-first):
- `M028-S01-ARTIFACT-CONTRACT`: fresh DB rows (generated_at after migration) have `modification_mode` set and `replacement_content` non-null; `why_summary` is null/empty
- `M028-S01-NO-WHY-IN-RENDER`: dry-run output contains no `WHY:` or `**Why:**` strings
- `M028-S01-PR-CITATIONS`: dry-run output contains at least one PR citation link
- `M028-S01-MODE-FIELD`: at least one row with `modification_mode='section'` in the DB; if any page has ≥ `pageModeThreshold` matched sections, a `modification_mode='page'` row exists

Add `scripts/verify-m028-s01.test.ts` covering: check IDs, envelope shape, evaluation function behavior, and negative assertions (`WHY:` / `**Why:**` trigger failures).

### Sequencing

1. Migration + type changes (unblocks everything)
2. Parser replacement + storage changes (proves content format in DB)
3. Publisher renderer + type updates (proves published format)
4. Test rewrites + verifier (locks the contract)
5. End-to-end dry-run proof via verifier

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| JSON-first proof harness with stable check IDs | `scripts/verify-m027-s03.ts` (closest structural match) | Project standard: check IDs, raw evidence envelope, human-readable summary from same data. Structural template for `verify-m028-s01.ts`. |
| Voice style preservation | `createVoicePreservingPipeline()` + `buildVoicePreservingPrompt()` | Already outputs pure modification text. No change needed. M028 only touches what happens after the voice pipeline returns. |
| Grounding guardrail | `wikiAdapter` + `runGuardrailPipeline()` | Operates on `suggestion`/`replacementContent` text (not on `whySummary`). Unchanged — pass `replacementContent` in the same position. |
| DB incremental migration | Existing numbered SQL migrations in `src/db/migrations/` | Next number is 030. Follow `ALTER TABLE` + new column convention (see migration 027). |
| GitHub comment upsert/scan | `upsertCIComment()` pattern in `src/handlers/ci-failure.ts` | Not needed in S01 (dry-run only), but S02 will reuse this pattern for comment supersession. |

## Existing Code and Patterns

- `src/knowledge/wiki-update-types.ts` — The artifact contract file. `UpdateSuggestion` has `suggestion`, `whySummary: string` (non-nullable), no `modificationMode`. This is the primary type to extend.
- `src/knowledge/wiki-update-generator.ts` — Production path uses `createVoicePreservingPipeline`, not `buildGroundedSectionPrompt`. The `WHY:` violation is only at `parseGeneratedSuggestion(vr.suggestion)` (line 570), `storeSuggestion()` (line 667), and the `why_summary` column write (line 693). Change these three together.
- `src/knowledge/wiki-update-generator.ts` — `buildGroundedSectionPrompt()` (line 160) is **tested-only**, not in the production call graph. Mark `@deprecated` and rewrite its associated tests as positive guards for the new contract.
- `src/knowledge/wiki-voice-analyzer.ts` — `buildVoicePreservingPrompt()` (line 451) is the actual LLM prompt used in production; it already outputs pure wiki replacement text with no `WHY:` requirement. `VoicePreservedUpdate.suggestion` is the modification text. No changes needed to this file.
- `src/knowledge/wiki-publisher.ts` — `formatPageComment()` (line 28): emits `**Why:** {s.whySummary}` at line 46 and voice mismatch warning prose. Publisher DB query (line 233) selects `why_summary`. These are the two publisher locations that must change.
- `src/knowledge/wiki-publisher-types.ts` — `PageSuggestionGroup.suggestions[].whySummary: string` (line ~64). Must become `replacementContent: string`.
- `src/db/migrations/023-wiki-update-suggestions.sql` — `why_summary TEXT NOT NULL` and `UNIQUE (page_id, COALESCE(section_heading, ''))`. Both change in migration 030.
- `src/db/migrations/024-wiki-update-publishing.sql` — Adds `published_at` and `published_issue_number`. No `published_comment_id`. This is S02 scope; S01 is dry-run only.
- `src/db/migrations/027-wiki-update-grounding-status.sql` — Shows incremental `ALTER TABLE ... ADD COLUMN` pattern used by the project instead of full table replacement.
- `scripts/generate-wiki-updates.ts` — CLI entrypoint. Summary block uses "Suggestions generated/dropped" language; `UpdateGeneratorResult` field names match. Dry-run mode already supported. Remains the real entry point exercised by the verifier.
- `scripts/publish-wiki-updates.ts` — CLI entrypoint. Dry-run mode already supported and outputs `dryRunOutput`. The verifier exercises `--dry-run`. No structural changes needed to the CLI; only downstream types/format change.
- `scripts/verify-m027-s03.ts` / `verify-m027-s03.test.ts` — Closest structural match for the S01 verifier. Has stable check IDs, raw evidence preservation, evaluation function, proof harness builder, and CLI runner. Copy structure, not content.

## Constraints

- `why_summary TEXT NOT NULL` means existing rows have rationale text. Migration 030 must `ALTER TABLE ... ALTER COLUMN why_summary DROP NOT NULL` before new rows can omit it. Old unpublished rows with `suggestion`+`why_summary` will still publish under the old contract (publisher falls back to `suggestion` when `replacement_content` is null) — this is acceptable behavior for rows that predate the migration.
- The unique index `(page_id, COALESCE(section_heading, ''))` cannot distinguish a lead-section row from a full-page artifact — both have `sectionHeading = null` → `COALESCE(NULL, '') = ''`. The new unique index must include `modification_mode`.
- Full-page mode uses `sectionHeading = null` and `modificationMode = 'page'`. The generator must DELETE all existing rows for a page (regardless of mode) before inserting a page-mode artifact to avoid leaving orphaned section-mode rows behind.
- The voice pipeline output (`VoicePreservedUpdate.suggestion`) is already pure replacement text. The parser change (`parseModificationContent`) is trivial — just return the text as `replacementContent`. No voice pipeline changes needed.
- S01 is dry-run only. No live GitHub mutations. All artifact contract proofs must be completable without writing to `xbmc/wiki`.
- Tests in `wiki-update-generator.test.ts` assert `expect(prompt).toContain('Begin with "WHY: "')` — these must be rewritten as positive guards for the modification-only contract, not silently deleted.
- Tests in `wiki-publisher.test.ts` have `whySummary` in every fixture. These must be updated to use `replacementContent`, and `expect(result).toContain("**Why:**")` → `expect(result).not.toContain("**Why:**")`.
- `UpdateGeneratorResult` field names (`suggestionsGenerated`, `suggestionsDropped`) are used in the CLI summary block. If renamed, both type and summary render must change. Safest approach: add `modificationsGenerated` / `modificationsDropped` as aliases and update the CLI display text, keeping backward compat.

## Common Pitfalls

- **Assuming `buildGroundedSectionPrompt` is in the hot path** — It is not. The production generator uses `createVoicePreservingPipeline`. `buildGroundedSectionPrompt` is only imported in the test file. Changing only this function fixes nothing in production; the real changes are in `parseGeneratedSuggestion`, `storeSuggestion`, and `formatPageComment`.
- **Treating this as a formatter tweak** — Changing only `formatPageComment()` leaves the fake `whySummary` data still being generated by the parser and stored in the DB. Parser + storage + renderer must change together.
- **Using null sectionHeading as a page-mode sentinel** — The lead section already uses `sectionHeading = null`. Add `modification_mode` to the unique index. Do not encode page mode through a magic heading string.
- **Keeping voice mismatch warnings in published comments** — These are internal quality metadata. Publishing them is commentary, not modification content. Remove from `formatPageComment` output; keep the DB column and type field.
- **Page-mode as a separate LLM call** — For S01, page mode should stitch the per-section voice-pipeline outputs in document order. This reuses all existing generation and validation machinery without a new prompt, new token-budget calculation, or new validation logic.
- **Testing only the happy path** — Both the unit tests and the verifier must include explicit `not.toContain("WHY:")` and `not.toContain("**Why:**")` assertions. Negative contract guards are the regression proof for R029.
- **Verifier reading legacy rows** — Old unpublished rows with `replacement_content = null` must not be used as proof of the new contract. The verifier should target rows with `generated_at` after the migration timestamp, or run fresh generation as a prerequisite.

## Open Risks

- **Page-mode threshold subjectivity** — Default of 3 matched sections is conservative. Too low triggers page mode frequently; too high never triggers it. Set default at 3, expose as `pageModeThreshold` option on `UpdateGeneratorOptions`, and test both modes explicitly. The verifier should log why a page was handled as page mode so operators can inspect the decision.
- **Voice pipeline output when there is no `WHY:` expected** — The parser replacement is trivial, but a guard is still worth adding: post-parse, assert `replacementContent` does not start with `WHY:` or `WHY ` as a sanity check. If the model somehow produces rationale text, the modification-only contract is violated silently.
- **Existing unpublished suggestion-style rows** — Production DB has rows with `suggestion` + `why_summary` but `replacement_content = null`. The publisher fallback to `suggestion` means they can still publish under the old contract, but that is acceptable for S01 — fresh runs use the new contract. The verifier must not accidentally validate these old rows as proof.
- **`grounding_status` column check constraint** — Currently `CHECK (grounding_status IN ('grounded', 'ungrounded', 'no_update'))`. The `'partially-grounded'` value was added in migration 027. No change needed for S01, but confirm migration 027 added it to the check constraint, not just the column.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| PostgreSQL schema migration | no specific skill needed — standard ALTER TABLE patterns already in the repo | n/a |
| GitHub issue comment upsert | no new skill needed — `upsertCIComment()` pattern in `src/handlers/ci-failure.ts` is the template for S02 | n/a |
| MediaWiki/wiki publishing | none found | none found |

## Sources

- `buildGroundedSectionPrompt` (the `WHY:` instruction function) is **only imported in the test file**, not in the production call graph — the main generation path uses `createVoicePreservingPipeline` → `buildVoicePreservingPrompt` (source: `src/knowledge/wiki-update-generator.ts` lines 404–425; `src/knowledge/wiki-update-generator.test.ts` lines 4, 182–260)
- The `WHY:` contract violation in production is at `parseGeneratedSuggestion(vr.suggestion)` (line 570), which carves a fake `whySummary` from pure modification text using sentence-boundary fallback (source: `src/knowledge/wiki-update-generator.ts` lines 205–254, 570, 638, 693)
- `VoicePreservedUpdate.suggestion` is already pure wiki replacement text; `buildVoicePreservingPrompt` outputs modification content directly with no `WHY:` requirement (source: `src/knowledge/wiki-voice-analyzer.ts` lines 451–499; `src/knowledge/wiki-voice-types.ts` lines 91–116)
- `why_summary TEXT NOT NULL` and `UNIQUE (page_id, COALESCE(section_heading, ''))` are the two schema constraints that must change in migration 030 (source: `src/db/migrations/023-wiki-update-suggestions.sql`)
- `published_at` and `published_issue_number` are the only publish-tracking columns — no `published_comment_id` — making deterministic retrofit S02 scope, not S01 (source: `src/db/migrations/024-wiki-update-publishing.sql`)
- `formatPageComment()` at line 46 emits `**Why:** {s.whySummary}` and voice mismatch warning prose; publisher DB query (line 233) selects `why_summary` (source: `src/knowledge/wiki-publisher.ts` lines 28–100, 233–263)
- Next available migration number is 030 (source: `src/db/migrations/` directory listing — 029 is the last)
- M027 verifiers use stable check IDs, raw evidence envelopes, JSON-first output, and a proof harness builder — this is the project's preferred machine-checkable proof pattern (source: `scripts/verify-m027-s03.ts`)
- `grounding_status` check constraint includes `'partially-grounded'` from migration 027 (source: `src/db/migrations/027-wiki-update-grounding-status.sql`)
