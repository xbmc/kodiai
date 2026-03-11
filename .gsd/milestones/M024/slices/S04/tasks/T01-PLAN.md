# T01: 118-severity-demotion 01

**Slice:** S04 — **Milestone:** M024

## Description

Implement severity demotion for findings whose core claims depend on unverified external knowledge.

Purpose: Prevent hallucinated CRITICALs from bypassing suppression by capping primarily-external findings at medium severity. This is the enforcement layer that acts on Phase 117's claim classification results.

Output: `src/lib/severity-demoter.ts` module + tests + integration in review.ts pipeline

## Must-Haves

- [ ] "A primarily-external CRITICAL finding gets demoted to medium"
- [ ] "A primarily-external MAJOR finding gets demoted to medium"
- [ ] "A primarily-diff-grounded CRITICAL finding keeps its severity"
- [ ] "A mixed finding keeps its original severity"
- [ ] "Missing claim classification data does not trigger demotion (fail-open)"
- [ ] "Demoted findings carry originalSeverity for audit"
- [ ] "Every demotion is logged with findingTitle, originalSeverity, newSeverity, reason, summaryLabel"
- [ ] "isFeedbackSuppressionProtected naturally sees the demoted severity (medium) and does NOT protect the finding"

## Files

- `src/lib/severity-demoter.ts`
- `src/lib/severity-demoter.test.ts`
- `src/handlers/review.ts`
