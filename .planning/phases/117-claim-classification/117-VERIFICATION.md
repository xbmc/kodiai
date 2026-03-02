---
phase: 117
status: passed
verified: 2026-03-02
verifier: orchestrator-inline
---

# Phase 117: Claim Classification - Verification

## Goal Verification

**Phase Goal:** Every finding produced by the LLM gets its claims classified as diff-grounded or external-knowledge so downstream processing can act on them.

**Result:** PASSED

## Success Criteria

1. **After LLM generates review findings, a classification pass labels each finding's claims as diff-grounded or external-knowledge** -- PASSED
   - `classifyClaims()` called in review.ts pipeline at line 2963
   - Runs after enforcement, before suppression matching
   - Each finding decomposed into claims via `extractClaims()`
   - Each claim labeled: `diff-grounded`, `external-knowledge`, or `inferential`

2. **Claims referencing specific version numbers, release dates, or API behavior not visible in the diff are classified as external-knowledge** -- PASSED
   - 8 heuristic patterns: VERSION_PATTERN, RELEASE_DATE_PATTERN, API_BEHAVIOR_PATTERN, LIBRARY_BEHAVIOR_PATTERN, CVE_PATTERN, PERFORMANCE_PATTERN, COMPATIBILITY_PATTERN
   - Version numbers cross-referenced against diff content
   - 32 tests verify classification accuracy

3. **Classification results are attached to finding objects and available to downstream severity demotion and output filtering** -- PASSED
   - `ProcessedFinding` type extended with `claimClassification?: FindingClaimClassification`
   - Classification data flows through via `claimClassificationMap.get(finding.commentId)`
   - `summaryLabel` provides per-finding aggregate: `primarily-diff-grounded`, `primarily-external`, `mixed`

## Requirement Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| CLAIM-01 | PASSED | classifyClaims() in pipeline, labels claims as diff-grounded/external-knowledge/inferential |
| CLAIM-02 | PASSED | 8 heuristic patterns detect version numbers, dates, CVE refs, API behavior |
| CLAIM-03 | PASSED | ProcessedFinding.claimClassification carries data for Phase 118/119 |

## Must-Haves Verification

- [x] `classifyClaims()` accepts findings + diff context + PR metadata
- [x] Claim-level decomposition with three-tier labels
- [x] Heuristic detects external-knowledge signals (8 patterns)
- [x] LLM second-pass scaffolding (isAmbiguous, buildClassificationPrompt)
- [x] Per-finding summary classification
- [x] Fail-open on errors (default primarily-diff-grounded)
- [x] Type intersection pattern (ClaimClassifiedFinding)
- [x] Pipeline integration after enforcement, before suppression

## Test Results

```
bun test src/lib/claim-classifier.test.ts
32 pass, 0 fail, 51 expect() calls
```

## Score: 8/8 must-haves verified

---
*Verified: 2026-03-02*
