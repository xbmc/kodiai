---
phase: 123-update-generation
plan: 01
status: complete
---

# Plan 123-01 Summary: Foundation types, migration, task type

## What Was Built
- `wiki-update-types.ts` with 4 exported types: `SectionPatchMatch`, `UpdateSuggestion`, `UpdateGeneratorOptions`, `UpdateGeneratorResult`
- `023-wiki-update-suggestions.sql` migration with functional unique index on `(page_id, COALESCE(section_heading, ''))` to handle NULL lead sections
- `SECTION_UPDATE` task type registered as `"section.update"` in task-types.ts (non-agentic)

## Key Decisions
- Used functional unique index (`COALESCE`) instead of plain UNIQUE constraint to properly handle NULL section_heading (PostgreSQL treats NULLs as distinct in UNIQUE)
- Migration is 023 (next after 022-wiki-pr-evidence)
- `grounding_status` uses CHECK constraint for enum values: 'grounded', 'ungrounded', 'no_update'

## Key Files
- `src/knowledge/wiki-update-types.ts` (created)
- `src/db/migrations/023-wiki-update-suggestions.sql` (created)
- `src/db/migrations/023-wiki-update-suggestions.down.sql` (created)
- `src/llm/task-types.ts` (modified)

## Commit
`2cc9866fc3` — feat(123): add update suggestion types, migration, and task type
