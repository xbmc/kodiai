---
phase: 125-voice-preserving-updates
plan: 01
subsystem: knowledge
tags: [wiki, voice-analysis, llm, caching, mediawiki, style-extraction]

requires:
  - phase: 124-wiki-update-publishing
    provides: wiki_update_suggestions table and publishing pipeline
provides:
  - Spread content sampling for style extraction (beginning/middle/end)
  - Wiki convention extraction (categories, interwiki links, navboxes, templates)
  - DB-cached style descriptions with TTL and content-hash invalidation
  - Updated PageStyleDescription with wikiConventions field
affects: [125-02, wiki-voice-validator, wiki-update-generator]

tech-stack:
  added: [Bun.hash for content hashing]
  patterns: [spread sampling, content-hash cache invalidation, UPSERT cache pattern]

key-files:
  created:
    - src/db/migrations/025-wiki-style-cache.sql
  modified:
    - src/knowledge/wiki-voice-analyzer.ts
    - src/knowledge/wiki-voice-types.ts
    - src/knowledge/wiki-voice-analyzer.test.ts

key-decisions:
  - "Bun.hash used for content hash (fast, native, no dependency)"
  - "Spread sampling: first 2, middle 2, last 2 chunks with dedup for short pages"
  - "Cache TTL defaults to 7 days, invalidates on content-hash mismatch"
  - "extractWikiConventions scans ALL chunks (not just sampled) for complete coverage"
  - "sql parameter optional for backward compatibility (no caching without it)"

patterns-established:
  - "Spread sampling: select indices from beginning/middle/end instead of sequential first-N"
  - "Content-hash cache invalidation: hash page content, compare on lookup, auto-refresh on mismatch"

requirements-completed: [VOICE-01, VOICE-02, VOICE-03]

duration: 4min
completed: 2026-03-05
---

# Phase 125 Plan 01: Style Extraction with Spread Sampling, Wiki Conventions, and DB Caching Summary

**Spread content sampling from beginning/middle/end of pages, wiki convention extraction for categories/templates/navboxes, and DB-cached style descriptions with content-hash invalidation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-05T20:43:27Z
- **Completed:** 2026-03-05T20:47:21Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- sampleSpreadContent selects from beginning (first 2), middle (2 around midpoint), and end (last 2) of pages instead of sequential first-N
- extractWikiConventions deterministically scans all chunks for [[Category:...]], [[xx:...]], {{Navbox...}}, and {{TemplateName}} patterns
- Style extraction prompt now includes WIKI CONVENTIONS section instructing LLM to catalog wiki-specific structural elements
- wiki_style_cache table with content-hash invalidation and 7-day TTL avoids redundant LLM calls
- extractPageStyle accepts optional sql parameter for caching (backward compatible without)
- buildVoicePreservingPrompt updated to encourage formatting improvements per CONTEXT.md decisions

## Task Commits

Each task was committed atomically:

1. **Task 1: Spread sampling, wiki convention analysis, and updated types** - `bea96fea60` (feat) + `9ef33c3e00` (feat)
2. **Task 2: Style description DB cache with TTL and content-hash invalidation** - `50b41ddda2` (feat)

_Note: Tasks 1 and 2 code was interleaved; the linter auto-committed the TS changes, then the migration was committed separately._

## Files Created/Modified
- `src/db/migrations/025-wiki-style-cache.sql` - Cache table with page_id PK, content_hash, JSONB style_description, expires_at
- `src/knowledge/wiki-voice-analyzer.ts` - Added sampleSpreadContent, extractWikiConventions, computeContentHash, getCachedStyle, cacheStyleDescription; updated extractPageStyle with caching and spread sampling
- `src/knowledge/wiki-voice-types.ts` - Added wikiConventions to PageStyleDescription, added StyleCacheEntry type, added sql to VoicePreservingPipelineOptions
- `src/knowledge/wiki-voice-analyzer.test.ts` - 31 tests covering spread sampling, wiki conventions, content hash, cache hit/miss, backward compatibility

## Decisions Made
- Used Bun.hash for content hashing (fast, native, no external dependency)
- Spread sampling takes first 2, middle 2, last 2 with Set-based dedup for overlap on short pages
- extractWikiConventions scans ALL chunks for completeness, not just the sampled subset
- sql parameter is optional to maintain backward compatibility with callers that don't have DB access
- Cache UPSERT uses ON CONFLICT (page_id) DO UPDATE to handle re-caching cleanly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] buildVoicePreservingPrompt constraints updated per CONTEXT.md**
- **Found during:** Task 1
- **Issue:** Old prompt said "ONLY use formatting elements" which contradicts CONTEXT.md decision to "Improve formatting freely"
- **Fix:** Updated prompt to encourage formatting improvements, normalize inconsistencies, replace deprecated content. Updated test assertions accordingly.
- **Files modified:** src/knowledge/wiki-voice-analyzer.ts, src/knowledge/wiki-voice-analyzer.test.ts
- **Committed in:** bea96fea60

---

**Total deviations:** 1 auto-fixed (1 bug fix aligning code with CONTEXT.md)
**Impact on plan:** Necessary to match user decisions in CONTEXT.md. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Style extraction now uses spread sampling and wiki conventions -- ready for Plan 02 (voice validation improvements)
- Cache table migration ready for deployment
- All 31 tests passing

---
*Phase: 125-voice-preserving-updates*
*Completed: 2026-03-05*
