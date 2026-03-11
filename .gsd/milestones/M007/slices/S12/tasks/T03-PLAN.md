# T03: 41-feedback-driven-learning 03

**Slice:** S12 — **Milestone:** M007

## Description

Integrate feedback-driven suppression and confidence adjustment into the review pipeline with transparent disclosure in Review Details.

Purpose: Connect the feedback evaluation logic from plan 02 into the live review handler so that consistently-rejected patterns are auto-suppressed, confidence reflects feedback history, and Review Details reports the suppression count.
Output: review.ts with feedback suppression in the post-enforcement pipeline, feedback-adjusted confidence scores, and Review Details disclosure line.

## Must-Haves

- [ ] "When feedback.autoSuppress.enabled is true, findings matching suppressed fingerprints are marked suppressed in processedFindings"
- [ ] "When feedback.autoSuppress.enabled is false (default), no feedback suppression logic runs and no store queries execute"
- [ ] "CRITICAL findings are never feedback-suppressed even when their pattern fingerprint is in the suppression set"
- [ ] "Confidence scores in processedFindings reflect feedback adjustment (+10 thumbs-up, -20 thumbs-down) when feedback data exists"
- [ ] "Review Details includes feedback suppression count when patterns were auto-suppressed (e.g. '2 patterns auto-suppressed by feedback')"
- [ ] "Feedback evaluation errors log a warning and proceed with zero suppressions (fail-open)"

## Files

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
