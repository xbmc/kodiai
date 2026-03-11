# S11: Large Pr Intelligence

**Goal:** Foundation: risk scoring engine, per-file numstat parser, and largePR config schema.
**Demo:** Foundation: risk scoring engine, per-file numstat parser, and largePR config schema.

## Must-Haves


## Tasks

- [x] **T01: 40-large-pr-intelligence 01** `est:3min`
  - Foundation: risk scoring engine, per-file numstat parser, and largePR config schema.

Purpose: Provides the core scoring algorithm, data extraction, and configuration support that all subsequent plans depend on. The risk scorer takes per-file numstat data, path risk signals, file categories, and language data to produce sorted risk scores. The config schema makes thresholds and weights configurable per-repo.

Output: `src/lib/file-risk-scorer.ts` (scoring engine + triage), new export in `src/execution/diff-analysis.ts` (per-file numstat), and extended `src/execution/config.ts` (largePR schema + section fallback).
- [x] **T02: 40-large-pr-intelligence 02** `est:2min`
  - Tests for risk scoring engine and per-file numstat parser.

Purpose: Validates the scoring algorithm produces correct relative ordering (auth files > test files), log normalization works, triage respects threshold boundaries, and numstat parsing handles all line formats. TDD plan -- tests written first, then implementation verified.

Output: `src/lib/file-risk-scorer.test.ts` and additions to `src/execution/diff-analysis.test.ts`
- [x] **T03: 40-large-pr-intelligence 03** `est:3min`
  - Tiered prompt sections and Review Details disclosure for large PRs.

Purpose: When a large PR is detected, the review prompt must instruct the LLM differently for full-review vs abbreviated-review files. The Review Details summary must transparently disclose how many files were reviewed and list skipped files with their risk scores.

Output: Updated `src/execution/review-prompt.ts` with tiered prompt builder, updated `src/handlers/review.ts` formatReviewDetailsSummary with triage disclosure.
- [x] **T04: 40-large-pr-intelligence 04** `est:3min`
  - Pipeline integration: wire risk scoring and triage into the review handler.

Purpose: This is the final integration plan that connects all Phase 40 components into the live review pipeline. Risk scoring runs AFTER diff analysis and BEFORE prompt building, so the LLM only sees files selected for review. Post-LLM enforcement suppresses below-MAJOR findings on abbreviated-tier files as a safety net.

Output: Updated `src/handlers/review.ts` with full file triage pipeline integration.

## Files Likely Touched

- `src/lib/file-risk-scorer.ts`
- `src/execution/diff-analysis.ts`
- `src/execution/config.ts`
- `src/lib/file-risk-scorer.test.ts`
- `src/execution/diff-analysis.test.ts`
- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
- `src/handlers/review.ts`
