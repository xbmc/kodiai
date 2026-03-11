# T03: 121-page-popularity 03

**Slice:** S02 — **Milestone:** M025

## Description

Wire the popularity store and scorer into the application bootstrap to close two verification gaps.

Purpose: The popularity store (citation logger) and scorer (scheduled refresh) are fully implemented but never instantiated in src/index.ts. Without this wiring, no citation events accumulate in production and popularity scores never auto-refresh. This is ~15 lines of bootstrap code following established patterns.

Output: Modified src/index.ts with popularity store created, passed as wikiCitationLogger to createRetriever, scorer instantiated and started, and shutdown ref stored.

## Must-Haves

- [ ] "Wiki citation events are logged to the database whenever wiki pages appear in retrieval results"
- [ ] "The popularity scorer runs on a weekly schedule matching the staleness detector pattern"
- [ ] "Popularity scorer is stopped on graceful shutdown"

## Files

- `src/index.ts`
