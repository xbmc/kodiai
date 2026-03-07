---
phase: 123-update-generation
status: passed
verified_at: 2026-03-04
---

# Phase 123: Update Generation - Verification

## Phase Goal
LLM generates section-level rewrite suggestions for stale wiki pages, grounded in actual diff content with commit/PR citations.

## Success Criteria Check

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Section-level rewrite suggestions (not full-page) | PASS | `groupChunksIntoSections()` splits by sectionHeading; each section processed individually via voice pipeline |
| 2 | Grounded in actual code diff content with PR citations | PASS | `buildGroundedSectionPrompt()` feeds section-relevant patches; prompt enforces inline PR citations |
| 3 | Ungrounded suggestions excluded from publishing | PASS | `checkGrounding()` validates PR #NNNN citations match input patches; ungrounded suggestions dropped entirely |
| 4 | Top 20 pages by composite popularity score processed | PASS | SQL JOIN `wiki_page_popularity INNER JOIN wiki_pr_evidence ORDER BY composite_score DESC LIMIT 20` |

## Requirement Coverage

| ID | Description | Covered By | Status |
|----|-------------|------------|--------|
| UPDATE-01 | LLM generates section-level rewrite suggestions | Plan 01 (types), Plan 02 (generator) | PASS |
| UPDATE-02 | Suggestions grounded in actual code diff content | Plan 02 (grounding prompt + checkGrounding) | PASS |
| UPDATE-03 | Each suggestion cites the PR(s)/commit(s) | Plan 02 (buildGroundedSectionPrompt + extractCitedPrs) | PASS |
| UPDATE-04 | Top 20 pages by composite popularity score | Plan 02 (popularity JOIN query), Plan 03 (--top-n=20 default) | PASS |

## Must-Haves Check

### Plan 01
- [x] wiki_update_suggestions table with page_id, section_heading, suggestion, grounding_status, citing_prs, voice_scores
- [x] SECTION_UPDATE task type in TASK_TYPES
- [x] UpdateSuggestion, UpdateGeneratorOptions, SectionPatchMatch types exported

### Plan 02
- [x] matchPatchesToSection filters by >= 2 non-stopword token overlap
- [x] buildGroundedSectionPrompt includes PR numbers, patches, grounding rules
- [x] parseGeneratedSuggestion extracts WHY summary, detects NO_UPDATE
- [x] checkGrounding validates PR citations against input patches
- [x] createUpdateGenerator().run() processes pages end-to-end

### Plan 03
- [x] Script processes top 20 pages by default
- [x] --dry-run, --page-ids, --top-n, --rate-limit flags supported
- [x] Summary logging with results
- [x] Clean exit with proper error handling

## Test Results
- 24 unit tests passing (wiki-update-generator.test.ts)
- All tests cover: matchPatchesToSection, buildGroundedSectionPrompt, parseGeneratedSuggestion, checkGrounding

## Artifacts Created
- `src/knowledge/wiki-update-types.ts`
- `src/knowledge/wiki-update-generator.ts`
- `src/knowledge/wiki-update-generator.test.ts`
- `src/db/migrations/023-wiki-update-suggestions.sql`
- `src/db/migrations/023-wiki-update-suggestions.down.sql`
- `scripts/generate-wiki-updates.ts`
- `src/llm/task-types.ts` (modified)

## Result
**PASSED** — All success criteria met, all requirements covered, 24 tests passing.
