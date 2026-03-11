# T02: 121-page-popularity 02

**Slice:** S02 — **Milestone:** M025

## Description

Build the linkshere API fetcher, composite popularity scorer with scheduler, and initial backfill script.

Purpose: Completes the popularity scoring system by adding the inbound links signal (POP-01), computing edit recency (POP-03), combining all signals into a composite score (POP-04), and providing both scheduled refresh and one-time backfill capabilities.

Output: Three new modules — a linkshere fetcher, a scorer with scheduler, and a backfill script.

## Must-Haves

- [ ] "Inbound link counts from MediaWiki linkshere API are stored for every wiki page"
- [ ] "Edit recency is computed using exponential decay from last_modified timestamp"
- [ ] "A composite popularity score exists per page combining all three signals"
- [ ] "Top-N pages by popularity score can be queried and return a deterministic ordered result"
- [ ] "The popularity scorer runs on a weekly schedule matching the staleness detector pattern"

## Files

- `src/knowledge/wiki-linkshere-fetcher.ts`
- `src/knowledge/wiki-popularity-scorer.ts`
- `src/knowledge/wiki-popularity-backfill.ts`
