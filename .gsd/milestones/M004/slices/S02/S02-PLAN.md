# S02: Context Aware Reviews

**Goal:** Add config schema fields for path-scoped instructions, profile presets, and file category overrides.
**Demo:** Add config schema fields for path-scoped instructions, profile presets, and file category overrides.

## Must-Haves


## Tasks

- [x] **T01: 27-context-aware-reviews 01** `est:3min`
  - Add config schema fields for path-scoped instructions, profile presets, and file category overrides. Create deterministic diff analysis module as a pure function.

Purpose: Establish the data model and analysis engine that Plan 02 will wire into the review prompt and handler.
Output: Extended config schema with tests, new diff-analysis.ts module with tests.
- [x] **T02: 27-context-aware-reviews 02** `est:5min`
  - Wire path instruction matching, profile preset resolution, and diff analysis into the review prompt builder and handler. Enrich the review prompt with contextual intelligence.

Purpose: Complete the context-aware review pipeline so reviews adapt to repo-specific conventions and risk patterns.
Output: Enriched review prompt with diff analysis context and path-scoped instructions, handler wiring for the complete pipeline.
- [x] **T03: 27-context-aware-reviews 03** `est:1 min`
  - Close the Phase 27 UAT blocker by making review diff collection resilient in shallow workspaces where `origin/base...HEAD` has no merge base.

Purpose: Restore live review execution so path instructions and diff context can run on real PRs instead of failing early with exit code 128.
Output: Hardened review handler diff strategy with regression tests proving no-merge-base scenarios still reach prompt enrichment.
- [x] **T04: 27-context-aware-reviews 04** `est:2 min`
  - Close the remaining Phase 27 verification gap by adding explicit elapsed-time guardrails to deterministic diff analysis.

Purpose: Enforce the locked performance boundary (time budget + file cap) so large or expensive analyses degrade predictably instead of running unbounded.
Output: Diff analysis now enforces elapsed-time limits with deterministic truncation signaling and regression tests that lock behavior.

## Files Likely Touched

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/execution/diff-analysis.ts`
- `src/execution/diff-analysis.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/execution/diff-analysis.ts`
- `src/execution/diff-analysis.test.ts`
