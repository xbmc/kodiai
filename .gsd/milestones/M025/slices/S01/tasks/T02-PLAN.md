# T02: 120-embedding-migration 02

**Slice:** S01 — **Milestone:** M025

## Description

Create the wiki embedding backfill script and the comparison benchmark script for the voyage-code-3 to voyage-context-3 migration.

Purpose: EMBED-01 requires all wiki page embeddings to be re-generated with voyage-context-3 atomically. The backfill script overwrites embeddings in place. The comparison benchmark validates retrieval quality before and after migration.

Output: Two reusable scripts in scripts/ directory.

## Must-Haves

- [ ] "Running the backfill script re-embeds all wiki pages with voyage-context-3 via contextualizedEmbed()"
- [ ] "After backfill, zero rows in wiki_pages have embedding_model = 'voyage-code-3'"
- [ ] "The comparison benchmark script runs N queries against old vs new embeddings and shows results side by side"
- [ ] "Both scripts are reusable for future model evaluations (not one-time throwaway)"

## Files

- `scripts/wiki-embedding-backfill.ts`
- `scripts/embedding-comparison.ts`
