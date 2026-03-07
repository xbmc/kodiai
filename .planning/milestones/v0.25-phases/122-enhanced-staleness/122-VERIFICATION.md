---
phase: 122-enhanced-staleness
verified: 2026-03-04T00:00:00Z
status: passed
score: 13/13 must-haves verified
re_verification: false
---

# Phase 122: Enhanced Staleness Detection Verification Report

**Phase Goal:** Enhanced staleness detection with PR evidence
**Verified:** 2026-03-04
**Status:** PASSED
**Re-verification:** No - initial verification

## Goal Achievement

Phase 122 successfully replaces the commit-based staleness pipeline with a PR-based pipeline. Merged PRs are fetched, matched to wiki pages via enhanced heuristic scoring, patch evidence is stored in a new table, and the LLM evaluator receives actual diff content to ground its staleness assessment.

### Observable Truths - Plan 01

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | wiki_pr_evidence table exists with all required columns, UNIQUE(pr_number, file_path, matched_page_id), and 3 indexes | VERIFIED | `022-wiki-pr-evidence.sql` lines 4-23: all columns, composite unique, 3 CREATE INDEX statements |
| 2 | heuristicScore filters domain stopwords before token overlap check | VERIFIED | Lines 101-109 of detector.ts: `!DOMAIN_STOPWORDS.has(t)` applied to both chunk/heading and path tokens |
| 3 | heuristicScore applies 3x weight to tokens found in MediaWiki headings (== Heading ==) | VERIFIED | Lines 84-128 of detector.ts: `HEADING_WEIGHT = 3`, `score += HEADING_WEIGHT` for heading tokens |
| 4 | fetchMergedPRs uses pulls.list with state:closed filtered by merged_at, enriched with pulls.listFiles including patch hunks | VERIFIED | Lines 139-208 of detector.ts: full implementation with pagination, merged_at filter, listFiles call |
| 5 | PR evidence rows inserted with ON CONFLICT DO UPDATE for idempotent upserts | VERIFIED | Lines 245-249 of detector.ts: `ON CONFLICT (pr_number, file_path, matched_page_id) DO UPDATE SET...` |
| 6 | Issue references extracted from PR bodies using parseIssueReferences and stored as JSONB | VERIFIED | Lines 221-231 of detector.ts: `parseIssueReferences({prBody, commitMessages})` mapped to JSONB |

### Observable Truths - Plan 02

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 7 | runScan calls fetchMergedPRs instead of fetchChangedFiles | VERIFIED | Lines 619-625 of detector.ts: `const mergedPRs = await fetchMergedPRs(...)`. fetchChangedFiles absent from file (grep returns 0 matches). |
| 8 | heuristicPass stores matched patches via storePREvidence during matching | VERIFIED | Lines 379-395 of detector.ts: after building candidates, iterates PRs and calls `await storePREvidence(...)` for each matched file |
| 9 | evaluateWithLlm includes actual diff patches in the LLM prompt from wiki_pr_evidence | VERIFIED | Lines 422-453 of detector.ts: queries `FROM wiki_pr_evidence WHERE matched_page_id = ${candidate.pageId}`, formats patch content, appends to prompt |
| 10 | Run state tracks lastMergedAt as scan window cursor | VERIFIED | Lines 664-678 of detector.ts: `newestMergedAt` derived from `mergedPRs`, saved as `lastMergedAt` in run state. `lastMergedAt` field in WikiStalenessRunState type (types.ts line 68). |
| 11 | Backfill script processes 90 days of merged PRs with rate limiting and evidence storage | VERIFIED | `scripts/backfill-pr-evidence.ts` (361 lines): `--days 90` default, 300ms `setTimeout` delay between listFiles calls (line 290), full evidence storage |
| 12 | StalePage type includes prNumber field | VERIFIED | types.ts line 46: `prNumber: number \| null` in StalePage |
| 13 | WikiPageCandidate tracks affectingPRNumbers | VERIFIED | types.ts line 23: `affectingPRNumbers: number[]`; detector.ts line 373: populated from affectingPRSet |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/migrations/022-wiki-pr-evidence.sql` | PR evidence table schema with indexes | VERIFIED | 24 lines; CREATE TABLE with all 12 columns, UNIQUE constraint, 3 indexes |
| `src/db/migrations/022-wiki-pr-evidence.down.sql` | Rollback migration | VERIFIED | `DROP TABLE IF EXISTS wiki_pr_evidence;` |
| `src/knowledge/wiki-staleness-types.ts` | Extended types with PR-based fields | VERIFIED | 139 lines; exports WikiPageCandidate (with affectingPRNumbers), StalePage (with prNumber), WikiStalenessRunState (with lastMergedAt), MergedPR, PREvidence |
| `src/knowledge/wiki-staleness-detector.ts` | Full PR-based pipeline | VERIFIED | 775 lines; exports createWikiStalenessDetector, heuristicScore, DOMAIN_STOPWORDS; contains fetchMergedPRs, storePREvidence (internal); no fetchChangedFiles or CommitWithFiles |
| `src/knowledge/wiki-staleness-detector.test.ts` | Tests for enhanced heuristic and PR pipeline | VERIFIED | 11 tests, all passing; stopword filtering, heading 3x weight, mixed heading/body, DOMAIN_STOPWORDS export, PR-based mock (pulls.list/listFiles), "no merged PRs" test |
| `scripts/backfill-pr-evidence.ts` | 90-day PR evidence backfill script | VERIFIED | 361 lines; wiki pages loaded once, 300ms rate limiting, per-PR evidence storage, progress logging, summary output |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `wiki-staleness-detector.ts (runScan)` | `fetchMergedPRs` | Direct call replacing fetchChangedFiles | WIRED | Line 619: `const mergedPRs = await fetchMergedPRs(octokit, ...)` |
| `wiki-staleness-detector.ts (heuristicPass)` | `storePREvidence` | Called after matching candidates | WIRED | Line 393: `await storePREvidence(sql, pr, matches, logger)` |
| `wiki-staleness-detector.ts (evaluateWithLlm)` | `wiki_pr_evidence table` | SQL query for patches in LLM prompt | WIRED | Lines 424-430: `SELECT patch, pr_title, pr_number FROM wiki_pr_evidence WHERE matched_page_id = ${candidate.pageId}` |
| `wiki-staleness-detector.ts (storePREvidence)` | `../lib/issue-reference-parser.ts` | parseIssueReferences import | WIRED | Line 23: import; Line 221: `parseIssueReferences({prBody: pr.body ?? "", commitMessages: []})` |
| `wiki-staleness-detector.ts` | `022-wiki-pr-evidence.sql` | INSERT into wiki_pr_evidence | WIRED | Line 236: `INSERT INTO wiki_pr_evidence (...)` |
| `scripts/backfill-pr-evidence.ts` | `wiki-staleness-detector.ts` | Imports heuristicScore, DOMAIN_STOPWORDS | WIRED | Line 23: `import { heuristicScore, DOMAIN_STOPWORDS } from "../src/knowledge/wiki-staleness-detector.ts"` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| STALE-01 | 01, 02 | Recent merged PRs (last 90 days) scanned to identify code areas with significant changes | SATISFIED | fetchMergedPRs paginates merged PRs since last run; backfill covers 90 days; runScan uses PR-based pipeline |
| STALE-02 | 02 | Changed code areas matched to related wiki pages via retrieval pipeline | SATISFIED | heuristicPass matches PR file paths to wiki page chunk tokens; candidates passed to LLM evaluator |
| STALE-03 | 01, 02 | Diff content from PRs/commits preserved and fed to staleness analysis (not discarded) | SATISFIED | storePREvidence persists patch content; evaluateWithLlm queries wiki_pr_evidence and includes patches in LLM prompt |
| STALE-04 | 01 | Improved staleness precision with domain stopwords and section-heading weighting to reduce false positives | SATISFIED | DOMAIN_STOPWORDS (20 terms) exported and applied; HEADING_WEIGHT = 3 for MediaWiki == heading == syntax; all 8 heuristic tests pass |

All 4 STALE requirement IDs from both PLAN frontmatter sections are accounted for. No orphaned requirements detected (REQUIREMENTS.md marks all 4 as Complete for Phase 122).

### Anti-Patterns Found

None detected.

- No TODO/FIXME/PLACEHOLDER comments in modified files
- No stub implementations (return null / return {})
- No old commit-based code remaining (fetchChangedFiles, CommitWithFiles, MAX_COMMITS all absent)
- No empty handlers or unimplemented functions

### Commit Verification

All commits referenced in SUMMARY.md files verified present in git history:

- `8cb16281aa` - feat(122-01): create PR evidence migration and extend staleness types
- `d58ad8ccf0` - test(122-01): add failing tests (TDD RED)
- `aa736bf76b` - feat(122-01): enhance heuristicScore with stopwords and heading weighting
- `f0313fee36` - feat(122-01): add fetchMergedPRs and storePREvidence functions
- `3d776883de` - feat(122-02): wire PR-based pipeline into staleness detector
- `56045a9032` - feat(122-02): update tests for PR-based pipeline and create backfill script

### Human Verification Required

None identified. All key behaviors are verifiable from code structure.

The following behaviors are fully confirmed programmatically:
- Schema correctness verified from migration SQL
- Heuristic logic verified from source and confirmed by 11 passing tests
- Pipeline wiring verified via function call tracing
- LLM prompt enhancement verified from source (patch query + prompt construction)
- Type extensions verified from exports in types file

---

_Verified: 2026-03-04_
_Verifier: Claude (gsd-verifier)_
