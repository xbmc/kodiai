# S03: Enhanced Staleness

**Goal:** Create the database schema for PR evidence storage, enhance heuristicScore with domain stopwords and section-heading weighting, and build the PR fetching and evidence persistence functions.
**Demo:** Create the database schema for PR evidence storage, enhance heuristicScore with domain stopwords and section-heading weighting, and build the PR fetching and evidence persistence functions.

## Must-Haves


## Tasks

- [x] **T01: 122-enhanced-staleness 01** `est:3min`
  - Create the database schema for PR evidence storage, enhance heuristicScore with domain stopwords and section-heading weighting, and build the PR fetching and evidence persistence functions.

Purpose: Establishes the data layer and scoring improvements that Plan 02 wires into the live staleness detector pipeline. The migration must exist before evidence can be stored; the improved heuristic must exist before the PR pipeline can filter effectively.

Output: Migration 022 for wiki_pr_evidence table, extended staleness types, enhanced heuristicScore function, fetchMergedPRs function, and storePREvidence function. Tests for the enhanced heuristic.
- [x] **T02: 122-enhanced-staleness 02** `est:4min`
  - Wire the PR-based pipeline into the live staleness detector, replacing commit-based scanning with merged-PR scanning. Update the heuristic pass to store evidence for matched files, enhance LLM evaluation with actual diff content, and create the 90-day backfill script.

Purpose: This plan completes the Phase 122 transition from commit-based to PR-based staleness detection. After this plan, the weekly scanner fetches merged PRs, stores patch evidence for matched wiki pages, and the LLM evaluator can see actual code diffs instead of just file names. The backfill script populates the initial 90-day evidence window.

Output: Fully wired PR-based staleness pipeline, updated types, updated tests, and backfill script.

## Files Likely Touched

- `src/db/migrations/022-wiki-pr-evidence.sql`
- `src/db/migrations/022-wiki-pr-evidence.down.sql`
- `src/knowledge/wiki-staleness-types.ts`
- `src/knowledge/wiki-staleness-detector.ts`
- `src/knowledge/wiki-staleness-detector.test.ts`
- `src/knowledge/wiki-staleness-detector.ts`
- `src/knowledge/wiki-staleness-types.ts`
- `src/knowledge/wiki-staleness-detector.test.ts`
- `scripts/backfill-pr-evidence.ts`
