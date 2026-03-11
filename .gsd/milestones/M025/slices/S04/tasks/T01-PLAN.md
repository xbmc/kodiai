# T01: 123-update-generation 01

**Slice:** S04 — **Milestone:** M025

## Description

Create the type contracts, database migration, and task type registration for wiki update suggestion generation.

Purpose: Establish the foundation types and storage schema that the generator module (Plan 02) and CLI script (Plan 03) build on.
Output: Type definitions, DB migration for wiki_update_suggestions table, SECTION_UPDATE task type.

## Must-Haves

- [ ] wiki_update_suggestions table exists with columns for page_id, section_heading, suggestion, grounding_status, citing_prs, voice scores
- [ ] SECTION_UPDATE task type registered in TASK_TYPES constant
- [ ] UpdateSuggestion, UpdateGeneratorOptions, and SectionPatchMatch types are exported

## Files

- `src/knowledge/wiki-update-types.ts`
- `src/db/migrations/023-wiki-update-suggestions.sql`
- `src/db/migrations/023-wiki-update-suggestions.down.sql`
- `src/llm/task-types.ts`
