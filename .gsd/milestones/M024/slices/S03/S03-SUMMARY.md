---
id: S03
parent: M024
milestone: M024
provides:
  - standalone claim classifier module (src/lib/claim-classifier.ts)
  - claim classification types (ClaimLabel, SummaryLabel, ClaimClassifiedFinding)
  - diff parsing utilities for classifier (parseDiffForClassifier, buildFileDiffsMap)
  - LLM second-pass scaffolding (isAmbiguous, buildClassificationPrompt)
  - pipeline integration in review handler
requires: []
affects: []
key_files: []
key_decisions:
  - "Sentence-boundary splitting for claim extraction — simple and effective for review finding decomposition"
  - "Regex-based heuristic patterns for fast classification — version numbers, CVE refs, release dates, API behavior, compatibility, performance claims"
  - "Classification map by commentId for efficient lookup when building ProcessedFinding objects"
  - "Used unknown cast for enforcedFindings -> classifier input due to EnforcementFinding lacking commentId in type definition (present at runtime)"
patterns_established:
  - "Claim classification via type intersection: FindingForClassification + claimClassification field"
  - "Fail-open classification: errors return findings as primarily-diff-grounded"
  - "Diff parsing decoupled from review handler's diffAnalysis — lightweight per-classifier parser"
observability_surfaces: []
drill_down_paths: []
duration: 7min
verification_result: passed
completed_at: 2026-03-02
blocker_discovered: false
---
# S03: Claim Classification

**# Phase 117 Plan 01: Post-LLM Claim Classifier Summary**

## What Happened

# Phase 117 Plan 01: Post-LLM Claim Classifier Summary

**Hybrid heuristic+LLM claim classifier that decomposes review findings into individually-labeled claims (diff-grounded, external-knowledge, inferential) with pipeline integration**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-02T23:27:02Z
- **Completed:** 2026-03-02T23:33:52Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Standalone claim classifier module with types, extraction, heuristic classification, and summary aggregation
- 8 external-knowledge signal patterns: version numbers, CVE refs, release dates, API behavior, library behavior, performance claims, compatibility claims
- Diff-grounded detection via cross-referencing claims against actual diff content, PR description, and commit messages
- Inferential label for logical deductions from visible code (distinct from external assertions)
- LLM second-pass scaffolding: ambiguity detection, prompt builder, ready for Phase 118+ activation
- Pipeline integration between enforcement and suppression in review.ts
- 32 passing tests covering all classification paths and fail-open behavior

## Task Commits

Each task was committed atomically:

1. **Task 117-01-A: Claim classifier types and heuristic engine** - `b63249bcb8` (test: failing tests), `cc84ace6e0` (feat: implementation)
2. **Task 117-01-B: LLM second-pass and pipeline integration** - `1970cc904f` (feat: utilities + integration)

## Files Created/Modified
- `src/lib/claim-classifier.ts` — Types, extractClaims, classifyClaimHeuristic, computeSummaryLabel, classifyClaims, parseDiffForClassifier, buildFileDiffsMap, isAmbiguous, buildClassificationPrompt
- `src/lib/claim-classifier.test.ts` — 32 tests covering extraction, heuristic classification, summary labels, integration, diff parsing, ambiguity detection, prompt building
- `src/handlers/review.ts` — Import, ProcessedFinding type extension, classification pipeline step, logging

## Decisions Made
- Sentence-boundary splitting for claim extraction rather than more complex NLP — simple and effective for review findings
- Classification map by commentId for O(1) lookup when building ProcessedFinding objects
- LLM second-pass not wired to actual LLM calls yet — scaffolding in place, activation deferred to downstream phases that need it
- Pre-existing type errors in review.ts (versionDiffs, snippet, changedFiles) left as-is — not introduced by this phase

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed release date regex to handle article before month**
- **Found during:** Task 117-01-A (GREEN phase)
- **Issue:** Regex for release date detection didn't account for "the" before month name (e.g., "introduced in the March 2024 release")
- **Fix:** Added optional `(?:the\s+)?` group in RELEASE_DATE_PATTERN
- **Files modified:** src/lib/claim-classifier.ts
- **Verification:** Test now passes
- **Committed in:** cc84ace6e0

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor regex fix, no scope change.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Claim classification data now flows through ProcessedFinding objects
- Phase 118 (Severity Demotion) can read `finding.claimClassification.summaryLabel` to cap severity
- Phase 119 (Output Filtering) can read per-claim labels to rewrite or suppress findings
- LLM second-pass scaffolding ready if downstream phases need higher accuracy on ambiguous claims

---
*Phase: 117-claim-classification*
*Completed: 2026-03-02*
