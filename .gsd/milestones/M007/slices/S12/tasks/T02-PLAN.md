# T02: 41-feedback-driven-learning 02

**Slice:** S12 — **Milestone:** M007

## Description

Build the feedback aggregator, safety guard, confidence adjuster, and barrel export using TDD.

Purpose: Create the core business logic that decides which finding patterns to auto-suppress based on feedback, with safety floors preventing suppression of critical/security findings.
Output: Tested pure-function modules in `src/feedback/` with a public `evaluateFeedbackSuppressions()` orchestrator.

## Must-Haves

- [ ] "evaluateFeedbackSuppressions returns fingerprints exceeding threshold (3+ thumbsDown, 3+ distinctReactors, 2+ distinctPRs)"
- [ ] "Patterns with insufficient thumbsDown, insufficient distinct reactors, or insufficient distinct PRs are NOT in the suppression set"
- [ ] "CRITICAL-severity patterns are never included in suppression set regardless of feedback volume"
- [ ] "MAJOR security/correctness patterns are never included in suppression set regardless of feedback volume"
- [ ] "MAJOR style/performance/documentation patterns CAN be suppressed (not safety-protected)"
- [ ] "Confidence adjustment adds +10 per thumbs-up and subtracts -20 per thumbs-down, clamped to [0, 100]"
- [ ] "evaluateFeedbackSuppressions early-returns empty result when config.enabled is false"

## Files

- `src/feedback/aggregator.ts`
- `src/feedback/aggregator.test.ts`
- `src/feedback/safety-guard.ts`
- `src/feedback/safety-guard.test.ts`
- `src/feedback/confidence-adjuster.ts`
- `src/feedback/confidence-adjuster.test.ts`
- `src/feedback/index.ts`
