# T02: 40-large-pr-intelligence 02

**Slice:** S11 — **Milestone:** M007

## Description

Tests for risk scoring engine and per-file numstat parser.

Purpose: Validates the scoring algorithm produces correct relative ordering (auth files > test files), log normalization works, triage respects threshold boundaries, and numstat parsing handles all line formats. TDD plan -- tests written first, then implementation verified.

Output: `src/lib/file-risk-scorer.test.ts` and additions to `src/execution/diff-analysis.test.ts`

## Must-Haves

- [ ] "Risk scoring tests cover normalization, edge cases, and tier assignment"
- [ ] "Per-file numstat parser tests cover normal lines, binary files, and empty input"
- [ ] "Triage tests verify threshold boundary behavior"

## Files

- `src/lib/file-risk-scorer.test.ts`
- `src/execution/diff-analysis.test.ts`
