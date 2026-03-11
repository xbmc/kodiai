# T02: 45-author-experience-adaptation 02

**Slice:** S04 — **Milestone:** M008

## Description

Wire author classification into the review pipeline: SQLite cache table, handler integration with Search API enrichment, prompt injection, Review Details transparency, and fail-open error handling.

Purpose: Connect the tested classification logic (plan 01) to the live review flow so that PR reviews adapt tone based on author experience level, with aggressive caching to minimize API calls and consistent fail-open semantics.

Output: Fully integrated author experience adaptation visible in review output.

## Must-Haves

- [ ] "Author classification is cached in SQLite with a 24-hour TTL"
- [ ] "Cache miss for ambiguous associations triggers optional GitHub Search API PR count lookup"
- [ ] "Search API failure returns null and classification proceeds without enrichment (fail-open)"
- [ ] "Classification failure at any point defaults to regular tier (fail-open)"
- [ ] "First-time contributor review prompts include educational tone directives"
- [ ] "Core contributor review prompts include terse tone directives"
- [ ] "Author tier appears in Review Details appendix for transparency"
- [ ] "Stale author cache entries (>7 days) are purged alongside existing purgeOldRuns"

## Files

- `src/knowledge/store.ts`
- `src/knowledge/types.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
