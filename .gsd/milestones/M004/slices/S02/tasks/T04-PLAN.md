# T04: 27-context-aware-reviews 04

**Slice:** S02 — **Milestone:** M004

## Description

Close the remaining Phase 27 verification gap by adding explicit elapsed-time guardrails to deterministic diff analysis.

Purpose: Enforce the locked performance boundary (time budget + file cap) so large or expensive analyses degrade predictably instead of running unbounded.
Output: Diff analysis now enforces elapsed-time limits with deterministic truncation signaling and regression tests that lock behavior.

## Must-Haves

- [ ] "Diff analysis enforces an explicit elapsed-time budget during category and risk scanning"
- [ ] "When time budget is exceeded, analysis degrades gracefully and returns a deterministic truncation signal"
- [ ] "Complexity metrics shape remains stable (files touched, lines added/removed, hunk count) regardless of truncation"
- [ ] "Regression tests cover both within-budget and exceeded-budget analyzer paths"

## Files

- `src/execution/diff-analysis.ts`
- `src/execution/diff-analysis.test.ts`
