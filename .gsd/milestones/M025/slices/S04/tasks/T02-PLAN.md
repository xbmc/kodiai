# T02: 123-update-generation 02

**Slice:** S04 — **Milestone:** M025

## Description

Build the core update generator module with section-to-patch matching, grounding prompt construction, grounding validation, and end-to-end pipeline orchestration.

Purpose: This is the heart of Phase 123 — the module that connects staleness evidence (Phase 122) with voice-preserving generation (Phase 125) to produce grounded, cited section rewrite suggestions.
Output: `wiki-update-generator.ts` with `createUpdateGenerator` factory function and unit tests.

## Must-Haves

- [ ] matchPatchesToSection returns only patches with non-stopword token overlap >= 2 for a given section
- [ ] buildGroundedSectionPrompt includes PR numbers, patch diffs, grounding rules, and citation format instructions
- [ ] parseGeneratedSuggestion extracts WHY summary and detects NO_UPDATE responses
- [ ] checkGrounding verifies at least one PR citation matching input patches exists in generated text
- [ ] createUpdateGenerator().run() processes top N pages by popularity, generates section suggestions via voice pipeline, stores results in wiki_update_suggestions

## Files

- `src/knowledge/wiki-update-generator.ts`
- `src/knowledge/wiki-update-generator.test.ts`
