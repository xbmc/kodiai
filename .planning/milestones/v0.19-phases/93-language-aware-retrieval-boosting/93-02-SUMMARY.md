---
phase: 93-language-aware-retrieval-boosting
plan: "02"
subsystem: knowledge/wiki
tags: [language-detection, wiki-chunker, wiki-store, tdd]
dependency_graph:
  requires: []
  provides: [wiki-language-tags, detectLanguageTags]
  affects: [wiki-store, wiki-chunker, wiki-types]
tech_stack:
  added: []
  patterns: [page-level-language-analysis, fenced-code-block-detection, prose-mention-detection]
key_files:
  created: []
  modified:
    - src/knowledge/wiki-chunker.ts
    - src/knowledge/wiki-chunker.test.ts
    - src/knowledge/wiki-types.ts
    - src/knowledge/wiki-store.ts
    - src/knowledge/wiki-store.test.ts
decisions:
  - "Language tags determined at page level (not per-chunk) so all chunks from a Python API page are tagged python"
  - "Two-pass detection: fenced code blocks (high confidence) + prose mentions (language context words)"
  - "Default to ['general'] when no languages detected — explicit signal for non-code pages"
  - "Use sql.array() for postgres.js TEXT[] column insertion"
metrics:
  duration_minutes: 4
  tasks_completed: 2
  files_modified: 5
  completed_date: "2026-02-25"
---

# Phase 93 Plan 02: Wiki Language Affinity Tag Detection Summary

**One-liner:** detectLanguageTags function added to wiki chunker detecting languages from fenced code blocks and prose mentions, wired through WikiPageChunk/WikiPageRecord types and wiki-store INSERT/SELECT for full persistence.

## What Was Built

Language affinity tagging for wiki pages is now complete end-to-end:

1. **`detectLanguageTags(rawText: string): string[]`** exported from `wiki-chunker.ts`:
   - Scans fenced code blocks with ` ```lang ` patterns, maps to canonical names via `CODE_BLOCK_LANG_ALIASES`
   - Detects prose language mentions (e.g. "TypeScript API", "Python implementation")
   - Returns `["general"]` when no languages detected
   - Returns sorted, deduplicated canonical names

2. **`chunkWikiPage`** updated to call `detectLanguageTags` on full page content before chunking, setting `languageTags` on every chunk (page-level analysis — all chunks get same tags).

3. **Type updates** in `wiki-types.ts`:
   - `WikiPageChunk.languageTags?: string[]` (optional, set by chunker)
   - `WikiPageRecord.languageTags: string[]` (always present after DB read)

4. **`wiki-store.ts`** updated:
   - `WikiRow.language_tags: string[]` internal type field
   - `rowToRecord` maps `language_tags` to `languageTags` with `?? []` fallback
   - Both `writeChunks` and `replacePageChunks` INSERT `language_tags` via `sql.array()`
   - Default to `["general"]` when chunk lacks `languageTags`

## Tests

- **wiki-chunker.test.ts**: 7 new tests — code block detection (python, c+cpp, js+python), alias normalization (py→python, js→javascript, ts→typescript), prose mention detection (TypeScript API), general fallback, and chunk wiring
- **wiki-store.test.ts**: 4 new tests — writeChunks stores tags, defaults to general, searchByEmbedding returns tags in results, replacePageChunks replaces old tags with new ones on re-ingest

All 30 chunker tests + all 16 store tests pass.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | bab4ebdc41 | feat(93-02): add language affinity tag detection to wiki chunker |
| 2 | af06517d3c | feat(93-02): wire language_tags through wiki-types and wiki-store |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/knowledge/wiki-chunker.ts` - FOUND (detectLanguageTags exported)
- `src/knowledge/wiki-types.ts` - FOUND (languageTags on both types)
- `src/knowledge/wiki-store.ts` - FOUND (language_tags in INSERT and rowToRecord)
- Commit bab4ebdc41 - FOUND
- Commit af06517d3c - FOUND
