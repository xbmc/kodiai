# T01: 56-foundation-layer 01

**Slice:** S01 — **Milestone:** M010

## Description

Add an additive knowledge-store table and a dedicated merge event handler so Kodiai can record dependency bump merge history for later trend analysis (DEP-05).

Purpose: Phase 56 requires persistence of dependency bump outcomes after merge, without triggering reviews or posting any comments.
Output: A new `dep_bump_merge_history` table + insert API in the knowledge store, and a `pull_request.closed` handler that records merged dep bump PRs.

## Must-Haves

- [ ] "When a dependency bump PR is merged, a merge-history row is recorded in the knowledge DB"
- [ ] "Non-dependency PR merges do not create merge-history rows"
- [ ] "Recording is fail-open: GitHub API/enrichment errors never block webhook processing"
- [ ] "Schema migration is additive-only (new table + indexes only)"

## Files

- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `src/handlers/dep-bump-merge-history.ts`
- `src/handlers/dep-bump-merge-history.test.ts`
- `src/index.ts`
