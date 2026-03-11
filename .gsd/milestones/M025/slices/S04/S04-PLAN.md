# S04: Update Generation

**Goal:** Create the type contracts, database migration, and task type registration for wiki update suggestion generation.
**Demo:** Create the type contracts, database migration, and task type registration for wiki update suggestion generation.

## Must-Haves


## Tasks

- [x] **T01: 123-update-generation 01**
  - Create the type contracts, database migration, and task type registration for wiki update suggestion generation.

Purpose: Establish the foundation types and storage schema that the generator module (Plan 02) and CLI script (Plan 03) build on.
Output: Type definitions, DB migration for wiki_update_suggestions table, SECTION_UPDATE task type.
- [x] **T02: 123-update-generation 02**
  - Build the core update generator module with section-to-patch matching, grounding prompt construction, grounding validation, and end-to-end pipeline orchestration.

Purpose: This is the heart of Phase 123 — the module that connects staleness evidence (Phase 122) with voice-preserving generation (Phase 125) to produce grounded, cited section rewrite suggestions.
Output: `wiki-update-generator.ts` with `createUpdateGenerator` factory function and unit tests.
- [x] **T03: 123-update-generation 03**
  - Create the CLI entry point script that runs the wiki update generation pipeline.

Purpose: Provide a standalone manual-trigger script (like existing backfill scripts) that operators run to generate wiki update suggestions for the most popular stale pages.
Output: `scripts/generate-wiki-updates.ts` runnable via `bun scripts/generate-wiki-updates.ts`

## Files Likely Touched

- `src/knowledge/wiki-update-types.ts`
- `src/db/migrations/023-wiki-update-suggestions.sql`
- `src/db/migrations/023-wiki-update-suggestions.down.sql`
- `src/llm/task-types.ts`
- `src/knowledge/wiki-update-generator.ts`
- `src/knowledge/wiki-update-generator.test.ts`
- `scripts/generate-wiki-updates.ts`
