# T01: 122-enhanced-staleness 01

**Slice:** S03 — **Milestone:** M025

## Description

Create the database schema for PR evidence storage, enhance heuristicScore with domain stopwords and section-heading weighting, and build the PR fetching and evidence persistence functions.

Purpose: Establishes the data layer and scoring improvements that Plan 02 wires into the live staleness detector pipeline. The migration must exist before evidence can be stored; the improved heuristic must exist before the PR pipeline can filter effectively.

Output: Migration 022 for wiki_pr_evidence table, extended staleness types, enhanced heuristicScore function, fetchMergedPRs function, and storePREvidence function. Tests for the enhanced heuristic.

## Must-Haves

- [ ] "wiki_pr_evidence table exists with PR metadata columns, file_path, patch, issue_references JSONB, matched_page_id, heuristic_score, and UNIQUE(pr_number, file_path, matched_page_id) constraint"
- [ ] "heuristicScore filters out domain stopwords before checking token overlap, reducing false positives from ubiquitous tokens like player/video/kodi/addon"
- [ ] "heuristicScore applies a 3x weight multiplier to tokens found in MediaWiki section headings (== Heading == syntax)"
- [ ] "fetchMergedPRs retrieves merged PRs from GitHub via pulls.list with state:closed filtered by merged_at, and enriches each with file details via pulls.listFiles including patch hunks"
- [ ] "PR evidence rows are inserted per (PR, file, matched_page) with ON CONFLICT DO UPDATE for idempotent upserts"
- [ ] "Issue references are extracted from PR bodies using the existing parseIssueReferences utility and stored as JSONB"

## Files

- `src/db/migrations/022-wiki-pr-evidence.sql`
- `src/db/migrations/022-wiki-pr-evidence.down.sql`
- `src/knowledge/wiki-staleness-types.ts`
- `src/knowledge/wiki-staleness-detector.ts`
- `src/knowledge/wiki-staleness-detector.test.ts`
