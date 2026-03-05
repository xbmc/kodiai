---
phase: 123-update-generation
plan: 02
status: complete
---

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
