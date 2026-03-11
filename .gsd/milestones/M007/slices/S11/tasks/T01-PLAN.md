# T01: 40-large-pr-intelligence 01

**Slice:** S11 — **Milestone:** M007

## Description

Foundation: risk scoring engine, per-file numstat parser, and largePR config schema.

Purpose: Provides the core scoring algorithm, data extraction, and configuration support that all subsequent plans depend on. The risk scorer takes per-file numstat data, path risk signals, file categories, and language data to produce sorted risk scores. The config schema makes thresholds and weights configurable per-repo.

Output: `src/lib/file-risk-scorer.ts` (scoring engine + triage), new export in `src/execution/diff-analysis.ts` (per-file numstat), and extended `src/execution/config.ts` (largePR schema + section fallback).

## Must-Haves

- [ ] "Each file in a PR gets a numeric risk score from 0-100 based on composite heuristics"
- [ ] "Risk scoring weights are configurable via .kodiai.yml largePR section"
- [ ] "Per-file numstat data (added/removed lines) is available for risk scoring"
- [ ] "Unknown config fields in largePR section degrade gracefully with warnings"

## Files

- `src/lib/file-risk-scorer.ts`
- `src/execution/diff-analysis.ts`
- `src/execution/config.ts`
