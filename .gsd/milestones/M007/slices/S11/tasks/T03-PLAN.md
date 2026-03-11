# T03: 40-large-pr-intelligence 03

**Slice:** S11 — **Milestone:** M007

## Description

Tiered prompt sections and Review Details disclosure for large PRs.

Purpose: When a large PR is detected, the review prompt must instruct the LLM differently for full-review vs abbreviated-review files. The Review Details summary must transparently disclose how many files were reviewed and list skipped files with their risk scores.

Output: Updated `src/execution/review-prompt.ts` with tiered prompt builder, updated `src/handlers/review.ts` formatReviewDetailsSummary with triage disclosure.

## Must-Haves

- [ ] "Review prompt includes tiered file sections when large PR context is provided"
- [ ] "Abbreviated tier files are explicitly instructed for CRITICAL/MAJOR only in the prompt"
- [ ] "Review Details discloses coverage (Reviewed X/Y files, prioritized by risk)"
- [ ] "Skipped files are listed with risk scores in a collapsible details block"
- [ ] "Mention-only file list is capped at 100 entries to avoid GitHub comment size limits"

## Files

- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
