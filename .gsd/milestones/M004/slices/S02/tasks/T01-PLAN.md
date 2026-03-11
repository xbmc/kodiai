# T01: 27-context-aware-reviews 01

**Slice:** S02 — **Milestone:** M004

## Description

Add config schema fields for path-scoped instructions, profile presets, and file category overrides. Create deterministic diff analysis module as a pure function.

Purpose: Establish the data model and analysis engine that Plan 02 will wire into the review prompt and handler.
Output: Extended config schema with tests, new diff-analysis.ts module with tests.

## Must-Haves

- [ ] "pathInstructions field accepts array of {path, instructions} objects with string or string[] path and defaults to empty array"
- [ ] "profile field accepts 'strict', 'balanced', or 'minimal' and is optional"
- [ ] "fileCategories field accepts optional category override maps (source, test, config, docs, infra)"
- [ ] "Invalid pathInstructions/profile/fileCategories values fall back to defaults via section-level fallback"
- [ ] "analyzeDiff classifies files into source/test/config/docs/infra categories using default patterns"
- [ ] "analyzeDiff detects path-based risk signals (auth, dependencies, infra, schema)"
- [ ] "analyzeDiff computes metrics (totalFiles, linesAdded, linesRemoved, hunksCount)"
- [ ] "analyzeDiff respects file count cap and marks large PRs"

## Files

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/execution/diff-analysis.ts`
- `src/execution/diff-analysis.test.ts`
