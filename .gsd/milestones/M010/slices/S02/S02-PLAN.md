# S02: Analysis Layer

**Goal:** Create the usage analyzer and scope coordinator pure-function modules.
**Demo:** Create the usage analyzer and scope coordinator pure-function modules.

## Must-Haves


## Tasks

- [x] **T01: 57-analysis-layer 01** `est:6 min`
  - Create the usage analyzer and scope coordinator pure-function modules.

Purpose: These modules implement the core analysis logic for DEP-04 (workspace usage evidence) and DEP-06 (multi-package coordination). They are pure functions with no side effects, testable in isolation, wired into the review handler in a later plan.

Output: Two new modules with tests in src/lib/
- [x] **T02: 57-analysis-layer 02** `est:0 min`
  - Create the retrieval recency weighting module that chains after language-aware reranking.

Purpose: Implements RET-04 -- recent learning memories score higher than stale ones, with a severity-aware decay floor that prevents CRITICAL/MAJOR findings from being forgotten. This is a pure function that takes RerankedResult[] (from rerankByLanguage) and returns RerankedResult[] with adjusted distances.

Output: New module with tests in src/learning/
- [x] **T03: 57-analysis-layer 03** `est:11 min`
  - Wire usage analysis, scope coordination, and recency weighting into the review pipeline and prompt rendering.

Purpose: Connect the three pure-function modules from Plans 01 and 02 into the live review handler and prompt builder, completing DEP-04, DEP-06, and RET-04 integration.

Output: Modified review handler, review prompt builder, and DepBumpContext type

## Files Likely Touched

- `src/lib/usage-analyzer.ts`
- `src/lib/usage-analyzer.test.ts`
- `src/lib/scope-coordinator.ts`
- `src/lib/scope-coordinator.test.ts`
- `src/learning/retrieval-recency.ts`
- `src/learning/retrieval-recency.test.ts`
- `src/lib/dep-bump-detector.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
