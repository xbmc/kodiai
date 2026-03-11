# T04: 40-large-pr-intelligence 04

**Slice:** S11 — **Milestone:** M007

## Description

Pipeline integration: wire risk scoring and triage into the review handler.

Purpose: This is the final integration plan that connects all Phase 40 components into the live review pipeline. Risk scoring runs AFTER diff analysis and BEFORE prompt building, so the LLM only sees files selected for review. Post-LLM enforcement suppresses below-MAJOR findings on abbreviated-tier files as a safety net.

Output: Updated `src/handlers/review.ts` with full file triage pipeline integration.

## Must-Haves

- [ ] "Large PRs trigger risk-based file triage before prompt building"
- [ ] "Triage uses configurable thresholds from config.largePR"
- [ ] "Only full+abbreviated tier files enter the LLM prompt"
- [ ] "Post-LLM enforcement suppresses MEDIUM/MINOR findings on abbreviated-tier files"
- [ ] "Triage data flows to formatReviewDetailsSummary for coverage disclosure"
- [ ] "Below-threshold PRs follow existing behavior with no changes"
- [ ] "Triage decision uses full PR file count, not incremental subset"

## Files

- `src/handlers/review.ts`
