# S02: Depends Pr Deep Review

**Goal:** Create the `[depends]` PR title detection module with comprehensive test coverage.
**Demo:** Create the `[depends]` PR title detection module with comprehensive test coverage.

## Must-Haves


## Tasks

- [x] **T01: 94-depends-pr-deep-review 01** `est:2min`
  - Create the `[depends]` PR title detection module with comprehensive test coverage.

Purpose: Enable Kodiai to identify Kodi-convention dependency bump PRs by title pattern, strictly mutually exclusive with the existing Dependabot/Renovate detector. This is the routing gate that determines whether a PR enters the deep-review pipeline.

Output: `src/lib/depends-bump-detector.ts` with exported `detectDependsBump()` function and types, plus test suite.
- [x] **T02: 94-depends-pr-deep-review 02** `est:3min`
  - Build the enrichment module for [depends] dependency bumps: VERSION file diff parsing, upstream changelog fetching, hash verification, and patch detection.

Purpose: Provide the factual data layer that powers the deep-review comment. Each enrichment function is deterministic and fail-open, producing structured data or graceful degradation notes.

Output: `src/lib/depends-bump-enrichment.ts` with exported enrichment functions, plus test suite.
- [x] **T03: 94-depends-pr-deep-review 03** `est:3min`
  - Build the impact analysis module for [depends] dependency bumps: #include tracing, cmake dependency parsing, and transitive dependency detection.

Purpose: Determine which parts of the Kodi codebase consume a bumped dependency and whether the bump introduces new transitive dependencies or version conflicts. This data powers the "Impact Assessment" section of the deep-review comment.

Output: `src/lib/depends-impact-analyzer.ts` with exported analysis functions, plus test suite.
- [x] **T04: 94-depends-pr-deep-review 04** `est:5min`
  - Build the structured review comment builder and wire the complete [depends] deep-review pipeline into the review handler.

Purpose: This is the integration plan that connects detection (Plan 01), enrichment (Plan 02), and impact analysis (Plan 03) into a working end-to-end pipeline. When a `[depends]` PR is detected, the handler runs enrichment, builds a structured comment, posts it, and conditionally runs the standard Claude review if source code beyond build configs was changed.

Output: `src/lib/depends-review-builder.ts` with comment builder, updated `src/handlers/review.ts` with pipeline integration.

## Files Likely Touched

- `src/lib/depends-bump-detector.ts`
- `src/lib/depends-bump-detector.test.ts`
- `src/lib/depends-bump-enrichment.ts`
- `src/lib/depends-bump-enrichment.test.ts`
- `src/lib/depends-impact-analyzer.ts`
- `src/lib/depends-impact-analyzer.test.ts`
- `src/lib/depends-review-builder.ts`
- `src/lib/depends-review-builder.test.ts`
- `src/handlers/review.ts`
