# T02: 54-security-advisory-changelog 02

**Slice:** S04 — **Milestone:** M009

## Description

Wire dep-bump enrichment into the review handler and extend the review prompt to render security advisory and changelog context.

Purpose: Connects the enrichment module (Plan 54-01) to the live review pipeline so users see CVE/advisory and changelog data in Kodiai reviews. Completes the end-to-end flow for all Phase 54 requirements.
Output: Updated review.ts with enrichment calls, updated review-prompt.ts with security + changelog prompt sections.

## Must-Haves

- [ ] "Detected dep bumps trigger parallel advisory + changelog enrichment before prompt building"
- [ ] "Enrichment results flow through DepBumpContext into the review prompt"
- [ ] "Review prompt shows advisory severity and remediation info for vulnerable packages"
- [ ] "Review prompt shows changelog/release notes between old and new versions"
- [ ] "Review prompt shows breaking change warnings extracted from changelog"
- [ ] "Enrichment failure does not block review (fail-open)"
- [ ] "Group bumps skip enrichment entirely"
- [ ] "Enrichment content is bounded by character budgets in the prompt"

## Files

- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
