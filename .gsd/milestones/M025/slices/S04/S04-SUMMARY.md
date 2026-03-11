---
id: S04
parent: M025
milestone: M025
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 
verification_result: passed
completed_at: 
blocker_discovered: false
---
# S04: Update Generation

**# Plan 123-01 Summary: Foundation types, migration, task type**

## What Happened

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

# Plan 123-03 Summary: CLI script entry point

## What Was Built
- `scripts/generate-wiki-updates.ts` — standalone CLI script following the backfill-wiki.ts pattern
- Supports `--top-n` (default 20), `--page-ids`, `--dry-run`, `--rate-limit` (default 300ms), `--help` flags
- Wires DB client, migrations, wiki page store, task router, telemetry store, and cost tracker
- Prints summary table on completion with pages/sections/suggestions/dropped/mismatches/duration

## Key Decisions
- Uses `createTelemetryStore` + `createCostTracker` for LLM cost tracking (first script to use LLM calls)
- Uses `createTaskRouter({ models: {} })` with empty overrides (same pattern as index.ts)
- `createWikiPageStore` called without embeddingModel (not doing embeddings)
- Hardcoded githubOwner="xbmc", githubRepo="xbmc" (single-wiki project)

## Key Files
- `scripts/generate-wiki-updates.ts` (created)

## Commit
`d4a3f59605` — feat(123): add CLI script for wiki update generation

# Plan 123-02 Summary: Core update generator module

## What Was Built
- `matchPatchesToSection()` — token overlap matching with DOMAIN_STOPWORDS filtering, >= 2 token threshold, top 5 patches, 3000 char cap
- `buildGroundedSectionPrompt()` — grounding-enforced prompt with PR citations, NO_UPDATE escape hatch, WHY prefix instruction
- `parseGeneratedSuggestion()` — extracts WHY summary, detects NO_UPDATE, fallback to first sentence
- `checkGrounding()` — validates at least one PR #NNNN citation matches input patches
- `createUpdateGenerator()` — full pipeline: popularity-ranked page selection with evidence JOIN, section decomposition, patch matching, voice pipeline generation, grounding check, DB storage with COALESCE-based upsert
- 24 unit tests covering all utility functions

## Key Decisions
- Section-to-patch matching uses union of file path tokens + patch content tokens vs section heading + body tokens
- MIN_OVERLAP_SCORE = 2 (at least 2 non-stopword tokens must overlap)
- Storage uses DELETE + INSERT in transaction to handle NULL section_heading (COALESCE in WHERE clause)
- Pages selected via JOIN between wiki_page_popularity and wiki_pr_evidence (only popular pages that ARE stale get processed)
- Rate limiting between pages (not between sections within a page)

## Key Files
- `src/knowledge/wiki-update-generator.ts` (created)
- `src/knowledge/wiki-update-generator.test.ts` (created)

## Commit
`18b78eec4b` — feat(123): implement wiki update generator with section matching and grounding
