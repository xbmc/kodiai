---
estimated_steps: 4
estimated_files: 2
---

# T01: New Modification Artifact Types and DB Migration

**Slice:** S01 — Modification Artifact Contract Through Real Entry Points
**Milestone:** M028

## Description

Introduce the first-class modification artifact contract at the type and schema layer. This is the foundation all other S01 tasks depend on: the generator and publisher cannot write or read `modificationMode`/`replacementContent` until these types exist. The migration also fixes the unique index to include `modification_mode`, preventing ambiguity between a lead-section artifact and a full-page artifact (both currently have `sectionHeading = null`).

## Steps

1. Write `src/db/migrations/030-wiki-modification-artifacts.sql` with four changes: (a) `ALTER TABLE wiki_update_suggestions ADD COLUMN modification_mode TEXT NOT NULL DEFAULT 'section' CHECK (modification_mode IN ('section', 'page'))`, (b) `ADD COLUMN replacement_content TEXT` (nullable — null means old row, non-null means new contract), (c) `ALTER COLUMN why_summary DROP NOT NULL`, (d) `DROP INDEX IF EXISTS idx_wiki_update_suggestions_page_section` then `CREATE UNIQUE INDEX idx_wiki_update_suggestions_page_section ON wiki_update_suggestions (page_id, modification_mode, COALESCE(section_heading, ''))`. Also write `030-wiki-modification-artifacts.down.sql` with the corresponding rollback.

2. In `src/knowledge/wiki-update-types.ts`, update `UpdateSuggestion` to: add `modificationMode: 'section' | 'page'` (required field), add `replacementContent: string` (the concrete wiki text; the primary artifact content), change `whySummary: string` to `whySummary: string | null`. Add `pageModeThreshold?: number` to `UpdateGeneratorOptions` (default 3, controls when page mode activates). Update `UpdateGeneratorResult` to rename `suggestionsGenerated → modificationsGenerated` and `suggestionsDropped → modificationsDropped` (or keep both names for backward compat — see note below).

3. Verify with `bunx tsc --noEmit` — this will reveal all the TypeScript sites that need updating (they're in T02 and T03, not T01, so expect errors at those callsites; confirm the types file itself is clean).

4. Run `bunx tsc --noEmit` and confirm the only errors are at existing callsites in wiki-update-generator.ts and wiki-publisher*.ts (not in the types file itself) — these are expected and will be fixed in T02/T03.

## Must-Haves

- [ ] `src/db/migrations/030-wiki-modification-artifacts.sql` exists with all four DDL changes
- [ ] `src/db/migrations/030-wiki-modification-artifacts.down.sql` exists with rollback DDL
- [ ] `UpdateSuggestion` exports `modificationMode: 'section' | 'page'` and `replacementContent: string`
- [ ] `UpdateSuggestion.whySummary` is `string | null` (nullable)
- [ ] `UpdateGeneratorOptions` has `pageModeThreshold?: number`
- [ ] `UpdateGeneratorResult` uses `modificationsGenerated`/`modificationsDropped` (rename or alias)

## Verification

- `bunx tsc --noEmit` exits clean on `wiki-update-types.ts` itself (callsite errors in generator/publisher are expected and will be fixed in T02/T03; 47 pre-existing M027 errors in unrelated files are out of scope)
- Migration SQL file contains `modification_mode`, `replacement_content`, and the new unique index DDL
- `grep -n 'modificationMode\|replacementContent' src/knowledge/wiki-update-types.ts` returns hits on the new fields

## Inputs

- `src/knowledge/wiki-update-types.ts` — current `UpdateSuggestion` shape with `suggestion`, `whySummary: string` (non-nullable), no `modificationMode`
- `src/db/migrations/023-wiki-update-suggestions.sql` — current schema baseline with `why_summary TEXT NOT NULL` and `UNIQUE (page_id, COALESCE(section_heading, ''))`
- `src/db/migrations/027-wiki-update-grounding-status.sql` — example of incremental `ALTER TABLE ... ADD COLUMN` pattern to follow

## Expected Output

- `src/db/migrations/030-wiki-modification-artifacts.sql` — new migration with `modification_mode`, `replacement_content`, nullable `why_summary`, updated unique index
- `src/db/migrations/030-wiki-modification-artifacts.down.sql` — rollback
- `src/knowledge/wiki-update-types.ts` — updated with `modificationMode`, `replacementContent`, nullable `whySummary`, `pageModeThreshold`, renamed result counts

## Observability Impact

**Signals introduced:**
- `modificationMode: 'section' | 'page'` on `UpdateSuggestion` — downstream generator (T02) will log `{ modificationMode, sectionsMatched, pageModeThreshold }` per page; operators can grep for `modificationMode` to see which mode was selected
- `modificationsGenerated` / `modificationsDropped` on `UpdateGeneratorResult` — run-level counters that surface in generator completion logs

**How a future agent inspects this task's outputs:**
- `grep -n 'modificationMode\|replacementContent\|modificationsGenerated' src/knowledge/wiki-update-types.ts` confirms new fields are present
- `ls src/db/migrations/030-*` confirms both up and down migrations exist
- `bunx tsc --noEmit 2>&1 | grep wiki-update-types` should produce zero errors (callsite errors in generator/publisher are expected; types file itself is clean)

**Failure visibility:**
- TypeScript callsite errors in `wiki-update-generator.ts` and `wiki-publisher*.ts` are the expected signal that T02/T03 have pending work — not a T01 failure
- If `wiki-update-types.ts` itself emits TS errors, that is a T01 regression
- Migration file missing `modification_mode` or the updated unique index is detectable via `grep modification_mode src/db/migrations/030-wiki-modification-artifacts.sql`
